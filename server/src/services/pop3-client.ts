import net from 'node:net';
import tls from 'node:tls';

export interface Pop3Options {
  host: string;
  port: number;
  secure: boolean;
  username: string;
  password: string;
  maxMessageSize: number;
  timeoutMs?: number;
}
export interface Pop3Message { number: number; uid: string; size: number }
export interface Pop3Connection {
  connect(): Promise<void>;
  list(): Promise<Pop3Message[]>;
  retrieve(number: number): Promise<Buffer>;
  quit(): Promise<void>;
  close(): void;
}

const failure = (code: string) => Object.assign(new Error('POP3 operation failed'), { code });

/** Read-only POP3: deliberately exposes no DELE command. RFC 1939 dot unstuffing. */
export class Pop3Client implements Pop3Connection {
  private socket?: net.Socket;
  private buffer = Buffer.alloc(0);
  private error?: Error;
  private wake?: () => void;
  private deadline?: NodeJS.Timeout;
  private readonly timeout: number;

  constructor(private readonly options: Pop3Options) {
    this.timeout = options.timeoutMs ?? 45000;
  }

  private fail(error: Error): void {
    this.error = error;
    this.socket?.destroy();
    this.wake?.();
  }

  private onData = (data: Buffer): void => {
    if (this.buffer.length + data.length > Math.max(this.options.maxMessageSize + 65536, 8 * 1024 * 1024)) {
      this.fail(failure('POP3_RESPONSE_TOO_LARGE'));
      return;
    }
    this.buffer = Buffer.concat([this.buffer, data]);
    this.wake?.();
  };
  private onError = (error: NodeJS.ErrnoException): void => this.fail(failure(error.code ?? 'ESOCKET'));
  private onClose = (): void => { this.error ??= failure('ESOCKET'); this.wake?.(); };
  private onTimeout = (): void => this.fail(failure('ETIMEDOUT'));

  private attach(socket: net.Socket): void {
    this.socket = socket;
    socket.on('data', this.onData);
    socket.on('error', this.onError);
    socket.on('close', this.onClose);
    socket.setTimeout(this.timeout, this.onTimeout);
  }

  private async line(limit: number): Promise<Buffer> {
    while (true) {
      const end = this.buffer.indexOf('\r\n');
      if (end >= 0) {
        if (end > limit) throw failure('POP3_RESPONSE_TOO_LARGE');
        const line = this.buffer.subarray(0, end);
        this.buffer = this.buffer.subarray(end + 2);
        return line;
      }
      if (this.buffer.length > limit) throw failure('POP3_RESPONSE_TOO_LARGE');
      if (this.error) throw this.error;
      await new Promise<void>(resolve => { this.wake = resolve; });
      this.wake = undefined;
    }
  }

  private async bounded<T>(operation: () => Promise<T>): Promise<T> {
    this.deadline = setTimeout(() => this.fail(failure('ETIMEDOUT')), this.timeout);
    try { return await operation(); }
    catch (error) { this.close(); throw error; }
    finally { clearTimeout(this.deadline); this.deadline = undefined; }
  }

  private async command(command: string, multiline = false, limit = 4096): Promise<Buffer> {
    if (/\r|\n|\x00/.test(command)) throw failure('POP3_INVALID_CREDENTIAL');
    return this.bounded(async () => {
      if (this.error || !this.socket || this.socket.destroyed) throw this.error ?? failure('ESOCKET');
      this.socket.write(command + '\r\n');
      const status = (await this.line(4096)).toString('utf8');
      if (!/^\+OK(?:\s|$)/.test(status)) {
        const code = /^(USER|PASS) /.test(command) ? 'EAUTH' : command === 'UIDL' ? 'POP3_UIDL_UNSUPPORTED' : 'POP3_COMMAND_FAILED';
        throw failure(code);
      }
      if (!multiline) return Buffer.from(status);
      const chunks: Buffer[] = [];
      let size = 0;
      while (true) {
        let line = await this.line(limit);
        if (line.equals(Buffer.from('.'))) break;
        if (line[0] === 46) line = line.subarray(1);
        size += line.length + 2;
        if (size > limit) throw failure('POP3_RESPONSE_TOO_LARGE');
        chunks.push(line, Buffer.from('\r\n'));
      }
      return Buffer.concat(chunks, size);
    });
  }

  async connect(): Promise<void> {
    if (!this.options.username || !this.options.password || /[\r\n\x00]/.test(this.options.username + this.options.password)) {
      throw failure('POP3_INVALID_CREDENTIAL');
    }
    const connection = { host: this.options.host, port: this.options.port };
    const tlsOptions = { servername: net.isIP(this.options.host) ? undefined : this.options.host, rejectUnauthorized: true };
    this.attach(this.options.secure ? tls.connect({ ...connection, ...tlsOptions }) : net.connect(connection));
    await this.bounded(async () => {
      if (!/^\+OK(?:\s|$)/.test((await this.line(4096)).toString('utf8'))) throw failure('POP3_GREETING_FAILED');
    });
    // Never send credentials on an unencrypted POP3 connection.
    if (!this.options.secure) {
      await this.command('STLS');
      const plain = this.socket!;
      plain.removeListener('data', this.onData);
      plain.removeListener('error', this.onError);
      plain.removeListener('close', this.onClose);
      plain.removeListener('timeout', this.onTimeout);
      if (this.buffer.length) { this.close(); throw failure('POP3_PROTOCOL_ERROR'); }
      this.attach(tls.connect({ socket: plain, ...tlsOptions }));
    }
    await this.command(`USER ${this.options.username}`);
    await this.command(`PASS ${this.options.password}`);
  }

  async list(): Promise<Pop3Message[]> {
    // UIDL is required: message numbers change when another client deletes mail.
    const uids = (await this.command('UIDL', true, 8 * 1024 * 1024)).toString('latin1').trim();
    const sizes = (await this.command('LIST', true, 8 * 1024 * 1024)).toString('latin1').trim();
    const sizeMap = new Map<number, number>();
    for (const row of sizes ? sizes.split('\r\n') : []) {
      const match = /^(\d+) (\d+)$/.exec(row);
      if (!match || !Number.isSafeInteger(Number(match[1])) || !Number.isSafeInteger(Number(match[2]))) throw failure('POP3_PROTOCOL_ERROR');
      if (sizeMap.has(Number(match[1]))) throw failure('POP3_PROTOCOL_ERROR');
      sizeMap.set(Number(match[1]), Number(match[2]));
    }
    const seenNumbers = new Set<number>();
    const seenUids = new Set<string>();
    const result: Pop3Message[] = [];
    for (const row of uids ? uids.split('\r\n') : []) {
      const match = /^(\d+) ([\x21-\x7e]{1,70})$/.exec(row);
      const number = Number(match?.[1]);
      const uid = match?.[2] ?? '';
      if (!match || !Number.isSafeInteger(number) || number < 1 || !sizeMap.has(number) || seenNumbers.has(number) || seenUids.has(uid)) throw failure('POP3_PROTOCOL_ERROR');
      seenNumbers.add(number); seenUids.add(uid);
      result.push({ number, uid, size: sizeMap.get(number)! });
      if (result.length > 50000) throw failure('POP3_RESPONSE_TOO_LARGE');
    }
    if (sizeMap.size !== result.length) throw failure('POP3_PROTOCOL_ERROR');
    return result;
  }

  async retrieve(number: number): Promise<Buffer> {
    if (!Number.isSafeInteger(number) || number < 1) throw failure('POP3_PROTOCOL_ERROR');
    return this.command(`RETR ${number}`, true, this.options.maxMessageSize);
  }
  async quit(): Promise<void> {
    try { if (this.socket && !this.socket.destroyed) await this.command('QUIT'); }
    finally { this.close(); }
  }
  close(): void { this.socket?.destroy(); this.wake?.(); }
}
