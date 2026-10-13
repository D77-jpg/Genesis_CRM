import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import tls from 'node:tls';
import { Pop3Client } from '../src/services/pop3-client';

// Real local POP3 wire exchange; only the TLS transport is substituted for net.
// Production uses certificate-verified TLS, which is asserted below. No external mailbox.
async function fixture(handler: (command: string, socket: net.Socket) => void,
  run: (port: number, commands: string[]) => Promise<void>, mockTls = true) {
  const commands: string[] = [];
  const sockets = new Set<net.Socket>();
  const server = net.createServer(socket => {
    sockets.add(socket); socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => undefined);
    socket.write('+OK local fixture\r\n');
    let input = '';
    socket.on('data', data => {
      input += data.toString();
      while (input.includes('\r\n')) {
        const end = input.indexOf('\r\n');
        const command = input.slice(0, end); input = input.slice(end + 2);
        commands.push(command); handler(command, socket);
      }
    });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as net.AddressInfo).port;
  const replacement = mockTls ? mock.method(tls, 'connect', (options: tls.ConnectionOptions) => {
    assert.equal(options.rejectUnauthorized, true);
    return net.connect({ host: options.host!, port: options.port! });
  }) : undefined;
  try { await run(port, commands); }
  finally { replacement?.mock.restore(); for (const socket of sockets) socket.destroy(); await new Promise<void>(resolve => server.close(() => resolve())); }
}
const client = (port: number, extra: object = {}) => new Pop3Client({ host: '127.0.0.1', port, secure: true,
  username: 'fixture@example.test', password: 'fixture-password', maxMessageSize: 4096, timeoutMs: 1000, ...extra });
const ordinary = (command: string, socket: net.Socket) => {
  if (/^(USER|PASS) /.test(command)) socket.write('+OK\r\n');
  else if (command === 'QUIT') socket.end('+OK goodbye\r\n');
  else socket.write('-ERR unsupported\r\n');
};

test('POP3 handles fragmented lines and dot-stuffing while preserving MIME bytes; never deletes', async () => {
  const mime = Buffer.from('From: sender@example.test\r\nSubject: fixture\r\n\r\n.hello\r\n你好\r\n');
  await fixture((command, socket) => {
    if (command === 'UIDL') socket.write('+OK\r\n1 stable-uid\r\n.\r\n');
    else if (command === 'LIST') socket.write(`+OK\r\n1 ${mime.length}\r\n.\r\n`);
    else if (command === 'RETR 1') {
      const wire = Buffer.concat([Buffer.from('+OK\r\n'), Buffer.from(mime.toString().replace(/(^|\r\n)\./g, '$1..')), Buffer.from('.\r\n')]);
      socket.write(wire.subarray(0, 7)); setTimeout(() => socket.write(wire.subarray(7)), 5);
    } else ordinary(command, socket);
  }, async (port, commands) => {
    const pop = client(port); await pop.connect();
    assert.deepEqual(await pop.list(), [{ number: 1, uid: 'stable-uid', size: mime.length }]);
    assert.deepEqual(await pop.retrieve(1), mime); await pop.quit();
    assert.ok(commands.includes('QUIT')); assert.ok(commands.every(command => !command.startsWith('DELE')));
  });
});
test('POP3 reports authentication failure without returning a server response or credentials', async () => {
  await fixture((command, socket) => command.startsWith('PASS ') ? socket.write('-ERR password=PRIVATE\r\n') : ordinary(command, socket), async port => {
    await assert.rejects(client(port).connect(), (error: any) => error.code === 'EAUTH' && !error.message.includes('PRIVATE'));
  });
});
test('POP3 refuses to authenticate without STLS when implicit SSL is disabled', async () => {
  await fixture(ordinary, async (port, commands) => {
    await assert.rejects(client(port, { secure: false }).connect());
    assert.deepEqual(commands, ['STLS']);
  }, false);
});
test('POP3 requires stable UIDL support rather than redownloading by mutable message numbers', async () => {
  await fixture(ordinary, async port => {
    const pop = client(port); await pop.connect();
    await assert.rejects(pop.list(), (error: any) => error.code === 'POP3_UIDL_UNSUPPORTED');
  });
});
test('POP3 bounds RETR bytes even when LIST would report a smaller size', async () => {
  await fixture((command, socket) => command.startsWith('RETR ') ? socket.write('+OK\r\n' + 'x'.repeat(100) + '\r\n.\r\n') : ordinary(command, socket), async port => {
    const pop = client(port, { maxMessageSize: 64 }); await pop.connect();
    await assert.rejects(pop.retrieve(1), (error: any) => error.code === 'POP3_RESPONSE_TOO_LARGE');
  });
});
test('POP3 rejects command injection and times out an incomplete response', async () => {
  await assert.rejects(client(1, { password: 'secret\r\nDELE 1' }).connect(), (error: any) => error.code === 'POP3_INVALID_CREDENTIAL');
  await fixture((command, socket) => { if (command !== 'UIDL') ordinary(command, socket); }, async port => {
    const pop = client(port, { timeoutMs: 50 }); await pop.connect();
    await assert.rejects(pop.list(), (error: any) => error.code === 'ETIMEDOUT');
  });
});
