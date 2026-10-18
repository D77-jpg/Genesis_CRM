import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, rm, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { z } from 'zod';

export const PARSER_VERSION = 'genesis-parser-s1.1';
export const parserConfig = { maxBytes: 15 * 1024 ** 2, timeoutMs: 180000, maxOutputBytes: 8 * 1024 ** 2, tokenBudget: 128, contract: 1 };
export const configHash = createHash('sha256').update(JSON.stringify(parserConfig)).digest('hex');
const location = z.record(z.unknown());
export const chunkResult = z.object({
  ordinal: z.number().int().nonnegative(), content: z.string().min(1).max(1000000), contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  tokenCount: z.number().int().positive(), indexEligible: z.boolean(), headingPath: z.array(z.string()),
  language: z.string(), location, table: z.record(z.unknown()).optional(), headers: z.array(z.string()).default([]), footnotes: z.array(z.string()).default([]),
  currencies: z.array(z.string()), units: z.array(z.string()), warnings: z.array(z.string()), reviewRequired: z.boolean().default(false),
});
export const resultSchema = z.object({
  type: z.literal('result'), state: z.enum(['succeeded', 'partial']), chunks: z.array(chunkResult).min(1).max(1200),
  warnings: z.array(z.string()), parserVersion: z.literal(PARSER_VERSION), packages: z.record(z.string()),
  tokenizer: z.string(), ocrWeights: z.record(z.string()), limits: z.record(z.number()), elapsedMs: z.number(),
});
export type ParserResult = z.infer<typeof resultSchema>;
export class ParserError extends Error {
  constructor(public code: string, message: string) { super(message); }
}

export async function parserIdentity() {
  const script = resolve(process.env.KNOWLEDGE_PARSER_SCRIPT || join(__dirname, '../../../parsers/knowledge_parser.py'));
  const lock = await readFile(join(script, '..', 'runtime-lock.json'), 'utf8');
  return { script, scriptHash: createHash('sha256').update(await readFile(script)).digest('hex'),
    runtimeLockHash: createHash('sha256').update(lock).digest('hex') };
}

const parserStops=new Set<()=>void>();
export function stopParserProcesses(){for(const stop of [...parserStops])stop();}

async function runParserImpl(data: Buffer, extension: string, sha256: string, signal: AbortSignal,
  progress: (value: { stage: string; done: number; total: number }) => Promise<void>): Promise<ParserResult> {
  const python = process.env.KNOWLEDGE_PYTHON;
  if (!python || !process.env.KNOWLEDGE_TOKENIZER_DIR) throw new ParserError('runtime_unavailable', '本地解析环境未配置，请联系管理员完成安装后重试');
  const { script } = await parserIdentity();
  const directory = await mkdtemp(join(tmpdir(), 'genesis-knowledge-'));
  const path = join(directory, 'source.bin');
  await writeFile(path, data, { mode: 0o600 });
  try {
    return await new Promise<ParserResult>((resolveResult, reject) => {
      // No inherited .env, database, mailbox or model-service credentials.
      const env: NodeJS.ProcessEnv = { PYTHONIOENCODING: 'utf-8', PYTHONDONTWRITEBYTECODE: '1', PYTHONUTF8: '1',
        OMP_NUM_THREADS: '4', OPENBLAS_NUM_THREADS: '4', KNOWLEDGE_TOKENIZER_DIR: process.env.KNOWLEDGE_TOKENIZER_DIR };
      for (const key of ['SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'PATH']) if (process.env[key]) env[key] = process.env[key];
      const child = spawn(python, ['-I', script], { env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
      let output = '', bytes = 0, result: ParserResult | undefined, error: Error | undefined;
      let updates = Promise.resolve();
      const shutdown=()=>{error=new ParserError('runtime_stopped','服务正在停止，任务保留并等待重启');child.kill();};parserStops.add(shutdown);
      const stop = () => { error ??= new ParserError('cancelled', '任务已取消或权限已变化'); child.kill(); };
      signal.addEventListener('abort', stop, { once: true });
      const timer = setTimeout(() => { error = new ParserError('timeout', '解析超过 180 秒，请拆分资料后重试'); child.kill(); }, parserConfig.timeoutMs);
      const accept = (line: string) => {
        if (!line.trim()) return;
        try {
          const message = JSON.parse(line);
          if (message.type === 'error') error = new ParserError(String(message.code).slice(0, 80), String(message.message).slice(0, 300));
          else if (message.type === 'result') result = resultSchema.parse(message);
          else if (message.type === 'progress') {
            const p = z.object({ stage: z.string().max(80), done: z.number().nonnegative(), total: z.number().positive() }).parse(message);
            updates = updates.then(() => progress(p)).catch(() => { error = new ParserError('storage_unavailable', '无法保存解析进度，请检查存储后重试'); child.kill(); });
          }
        } catch { error = new ParserError('invalid_result', '解析组件返回结果无效'); child.kill(); }
      };
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (part: string) => {
        bytes += Buffer.byteLength(part);
        if (bytes > parserConfig.maxOutputBytes) { error = new ParserError('output_limit', '解析结果过大，请拆分文档'); child.kill(); return; }
        output += part;
        let end: number;
        while ((end = output.indexOf('\n')) >= 0) { accept(output.slice(0, end)); output = output.slice(end + 1); }
      });
      // Drain stderr without persisting document fragments / native parser errors.
      child.stderr.on('data', () => undefined);
      child.stdin.on('error', () => undefined);
      child.on('error', () => { error = new ParserError('runtime_unavailable', '无法启动本地解析进程，请检查安装配置'); });
      child.on('close', (code) => {
        parserStops.delete(shutdown);clearTimeout(timer); signal.removeEventListener('abort', stop); accept(output);
        void updates.then(() => {
          if (error) reject(error);
          else if (code !== 0 || !result) reject(new ParserError('resource_or_process_failure', '解析进程退出或超过资源限制，请拆分文件并检查本地组件'));
          else resolveResult(result);
        }).catch(reject);
      });
      child.stdin.end(JSON.stringify({ path, extension, sha256 }) + '\n');
      if (signal.aborted) stop();
    });
  } finally { await rm(directory, { recursive: true, force: true }); }
}

const parserRuntime={active:0,failures:0,openUntil:0,completed:0,failed:0};
export function parserRuntimeStatus(){return {...parserRuntime,circuitOpen:parserRuntime.openUntil>Date.now(),maxConcurrent:2,timeoutMs:parserConfig.timeoutMs};}
export async function runParser(...args:Parameters<typeof runParserImpl>):Promise<ParserResult>{
 if(parserRuntime.openUntil>Date.now())throw new ParserError('circuit_open','本地解析组件连续故障，稍后重试或联系管理员');
 if(parserRuntime.active>=2)throw new ParserError('capacity_busy','本地解析任务繁忙，请稍后重试');
 parserRuntime.active++;try{const result=await runParserImpl(...args);parserRuntime.failures=0;parserRuntime.openUntil=0;parserRuntime.completed++;return result;}
 catch(e){parserRuntime.failed++;if(e instanceof ParserError&&['timeout','resource_or_process_failure','runtime_unavailable','invalid_result','storage_unavailable'].includes(e.code)&&++parserRuntime.failures>=3)parserRuntime.openUntil=Date.now()+30000;throw e;}
 finally{parserRuntime.active--;}
}
