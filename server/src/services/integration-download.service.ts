import { lookup } from 'node:dns/promises';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import env from '../config/env';
import { publicIpv4 } from './website/public-web';
import { ApiError } from '../utils/ApiError';
export const inquiryDownloadNetwork = { lookup };
export async function downloadInquiryAttachment(raw: string, maxBytes: number): Promise<Buffer> {
    let u: URL;
    try {
        u = new URL(raw);
    }
    catch {
        throw ApiError.badRequest('ATTACHMENT_URL_UNSAFE');
    }
    const allowed = env.GLOBALSITE_ATTACHMENT_ORIGINS.split(',').map(s => s.trim()).filter(Boolean);
    const local = env.NODE_ENV !== 'production' && env.GLOBALSITE_ALLOW_LOCAL && ['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname);
    if (!allowed.includes(u.origin) || u.username || u.password || u.hash || (!local && (u.protocol !== 'https:' || !!u.port)))
        throw ApiError.badRequest('ATTACHMENT_SOURCE_NOT_ALLOWED');
    const addresses = await inquiryDownloadNetwork.lookup(u.hostname.replace(/^\[|\]$/g, ''), { all: true, family: 4 });
    if (!addresses.length || (!local && addresses.some(a => !publicIpv4(a.address))))
        throw ApiError.badRequest('ATTACHMENT_URL_UNSAFE');
    const chosen = addresses.find(a => a.family === 4) ?? addresses[0];
    if (local && !addresses.every(a => a.address === '127.0.0.1' || a.address === '::1'))
        throw ApiError.badRequest('ATTACHMENT_URL_UNSAFE');
    return new Promise((resolve, reject) => {
        const request = (u.protocol === 'https:' ? httpsRequest : httpRequest)(u, { method: 'GET', agent: false, lookup: ((_host: any, _opts: any, cb: any) => { if (_opts?.all)
                cb(null, [chosen]);
            else
                cb(null, chosen.address, chosen.family); }) as any, headers: { Accept: 'application/octet-stream', 'User-Agent': 'GlobalCRM-InquiryAttachment/1.0' } }, res => {
            if (res.statusCode !== 200 || Number(res.headers['content-length'] ?? 0) > maxBytes) {
                res.destroy();
                reject(Error('ATTACHMENT_DOWNLOAD_FAILED'));
                return;
            }
            const chunks: Buffer[] = [];
            let bytes = 0;
            res.on('data', chunk => { bytes += chunk.length; if (bytes > maxBytes)
                res.destroy(Error('ATTACHMENT_TOO_LARGE'));
            else
                chunks.push(Buffer.from(chunk)); });
            res.on('end', () => resolve(Buffer.concat(chunks)));
            res.on('error', () => reject(Error('ATTACHMENT_DOWNLOAD_FAILED')));
        });
        const deadline=setTimeout(()=>request.destroy(Error('ATTACHMENT_DOWNLOAD_TIMEOUT')),15000);
        request.once('close',()=>clearTimeout(deadline));
        request.on('error', () => reject(Error('ATTACHMENT_DOWNLOAD_FAILED')));
        request.end();
    });
}
