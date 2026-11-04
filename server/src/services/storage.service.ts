/**
 * Storage abstraction for binary attachments.
 *
 * `local` keeps the current single-host behaviour. `s3` supports any
 * S3-compatible endpoint (AWS S3, MinIO, Aliyun OSS S3 gateway) with SigV4,
 * avoiding a provider SDK in the application process.
 */
import { createHash, createHmac } from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import env from '../config/env';
import { ApiError } from '../utils/ApiError';

export interface StoredObject {
  provider: 'local' | 's3';
  key: string;
  /** Local absolute path, or the same key for object storage. */
  path: string;
}

function sha256(value: Buffer | string): string {
  return createHash('sha256').update(value).digest('hex');
}

function hmac(key: Buffer | string, value: string): Buffer {
  return createHmac('sha256', key).update(value).digest();
}

function encodePath(value: string): string {
  return value.split('/').map((part) => encodeURIComponent(part)).join('/');
}

function s3Config(): { endpoint: URL; bucket: string; region: string; accessKey: string; secretKey: string; pathStyle: boolean } {
  if (!env.S3_BUCKET || !env.S3_ACCESS_KEY_ID || !env.S3_SECRET_ACCESS_KEY) {
    throw ApiError.internal('S3 存储配置不完整（S3_BUCKET / S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY）');
  }
  return {
    endpoint: new URL(env.S3_ENDPOINT || `https://s3.${env.S3_REGION}.amazonaws.com`),
    bucket: env.S3_BUCKET,
    region: env.S3_REGION,
    accessKey: env.S3_ACCESS_KEY_ID,
    secretKey: env.S3_SECRET_ACCESS_KEY,
    pathStyle: env.S3_FORCE_PATH_STYLE,
  };
}

function s3Request(method: 'GET' | 'PUT' | 'DELETE', key: string, body?: Buffer, contentType?: string): Promise<Response> {
  const config = s3Config();
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);
  const url = new URL(config.endpoint.toString());
  url.pathname = config.pathStyle
    ? `${url.pathname.replace(/\/$/, '')}/${encodeURIComponent(config.bucket)}/${encodePath(key)}`
    : `${url.pathname.replace(/\/$/, '')}/${encodePath(key)}`;
  if (!config.pathStyle) url.hostname = `${config.bucket}.${url.hostname}`;
  const payloadHash = sha256(body ?? '');
  const headers: Record<string, string> = {
    host: url.host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
  };
  if (contentType) headers['content-type'] = contentType;
  const signedHeaders = Object.keys(headers).sort().join(';');
  const canonicalHeaders = Object.keys(headers).sort().map((name) => `${name}:${headers[name]}\n`).join('');
  const canonicalRequest = [method, url.pathname, url.search.slice(1), canonicalHeaders, signedHeaders, payloadHash].join('\n');
  const scope = `${dateStamp}/${config.region}/s3/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonicalRequest)].join('\n');
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${config.secretKey}`, dateStamp), config.region), 's3'), 'aws4_request');
  const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex');
  headers.authorization = `AWS4-HMAC-SHA256 Credential=${config.accessKey}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  return fetch(url, { method, headers, ...(body ? { body } : {}) });
}

function ensureLocalDir(): string {
  const dir = path.resolve(env.UPLOAD_DIR);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function safeLocalPath(key: string): string {
  const root = ensureLocalDir();
  const resolved = path.resolve(root, key);
  if (path.dirname(resolved) !== root) throw ApiError.badRequest('非法存储路径');
  return resolved;
}

export function storageProviderName(): 'local' | 's3' {
  return env.STORAGE_PROVIDER;
}

export async function putObject(key: string, body: Buffer, contentType?: string): Promise<StoredObject> {
  if (env.STORAGE_PROVIDER === 's3') {
    const response = await s3Request('PUT', key, body, contentType);
    if (!response.ok) throw ApiError.internal(`对象存储写入失败（${response.status}）`);
    return { provider: 's3', key, path: key };
  }
  const fullPath = safeLocalPath(key);
  await fsp.writeFile(fullPath, body);
  return { provider: 'local', key, path: fullPath };
}

export async function getObject(key: string): Promise<Buffer> {
  if (env.STORAGE_PROVIDER === 's3') {
    const response = await s3Request('GET', key);
    if (!response.ok) throw ApiError.notFound('附件文件已丢失，请重新上传');
    return Buffer.from(await response.arrayBuffer());
  }
  try {
    return await fsp.readFile(safeLocalPath(key));
  } catch {
    throw ApiError.notFound('附件文件已丢失，请重新上传');
  }
}

export async function deleteObject(key: string): Promise<void> {
  if (env.STORAGE_PROVIDER === 's3') {
    const response = await s3Request('DELETE', key);
    if (!response.ok && response.status !== 404) throw ApiError.internal(`对象存储删除失败（${response.status}）`);
    return;
  }
  try {
    await fsp.unlink(safeLocalPath(key));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}

/** Read a legacy local attachment path without allowing traversal outside UPLOAD_DIR. */
export async function getLegacyLocalObject(filePath: string): Promise<Buffer> {
  const root = path.resolve(env.UPLOAD_DIR);
  const resolved = path.resolve(filePath);
  if (path.dirname(resolved) !== root) throw ApiError.notFound('附件文件不存在');
  if ((await fsp.lstat(resolved)).isSymbolicLink()) throw ApiError.notFound('附件文件不存在');
  return fsp.readFile(resolved);
}

export async function deleteLegacyLocalObject(filePath: string): Promise<void> {
  const root = path.resolve(env.UPLOAD_DIR);
  const resolved = path.resolve(filePath);
  if (path.dirname(resolved) !== root) return;
  try {
    await fsp.unlink(resolved);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}
