import { lookup } from 'node:dns/promises';
import { request } from 'node:https';
import { publicIpv4 } from './website/public-web';
import { ApiError } from '../utils/ApiError';
export const webhookNetwork = { lookup, request };
export async function webhookTarget(raw: string) {
    let u: URL;
    try {
        u = new URL(raw);
    }
    catch {
        throw ApiError.badRequest('WEBHOOK_TARGET_UNSAFE');
    }
    if (u.protocol !== 'https:' || u.username || u.password || u.port || u.search || u.hash || u.href.length > 2000)
        throw ApiError.badRequest('WEBHOOK_TARGET_UNSAFE');
    let addresses;
    let timeout: NodeJS.Timeout | undefined;
    try {
        addresses = await Promise.race([webhookNetwork.lookup(u.hostname, { all: true, family: 4 }), new Promise<never>((_r, reject) => { timeout = setTimeout(() => reject(Error('DNS_TIMEOUT')), 5000); })]);
    }
    catch {
        throw ApiError.badRequest('WEBHOOK_DNS_FAILED');
    }
    finally {
        if (timeout)
            clearTimeout(timeout);
    }
    if (!addresses.length || addresses.some(a => !publicIpv4(a.address)))
        throw ApiError.badRequest('WEBHOOK_TARGET_UNSAFE');
    return { url: u.href, chosen: addresses[0] };
}
export async function postWebhook(raw: string, body: Buffer, headers: Record<string, string>): Promise<{
    status: number;
}> {
    const target = await webhookTarget(raw);
    return new Promise((resolve, reject) => {
        const req = webhookNetwork.request(target.url, { method: 'POST', agent: false, family: 4, lookup: ((_h: any, o: any, cb: any) => o?.all ? cb(null, [target.chosen]) : cb(null, target.chosen.address, 4)) as any, headers: { ...headers, 'Content-Type': 'application/json', 'Content-Length': String(body.length), 'User-Agent': 'GlobalCRM-Webhooks/1.0' } }, res => {
            // Never follow redirects or retain receiver bodies/headers; destroy immediately after status.
            const status = res.statusCode ?? 0;
            res.destroy();
            resolve({ status });
        });
        const timer = setTimeout(() => req.destroy(Error('WEBHOOK_TIMEOUT')), 15000);
        req.once('close', () => clearTimeout(timer));
        req.once('error', () => reject(Error('WEBHOOK_NETWORK_FAILED')));
        req.end(body);
    });
}
