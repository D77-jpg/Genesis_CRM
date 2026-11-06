import { createHmac, timingSafeEqual } from 'node:crypto';
export function signWebhook(body: Buffer, timestamp: string, secret: string) { return 'v1=' + createHmac('sha256', Buffer.from(secret, 'utf8')).update(timestamp + '.').update(body).digest('hex'); }
/** Receiver utility only: the receiving application must also atomically deduplicate projectId/eventId. */
export function verifyWebhookSignature(body: Buffer, timestamp: string, signature: string, secret: string, now = Date.now()) {
    if (!/^[0-9]{10}$/.test(timestamp) || Math.abs(Math.floor(now / 1000) - Number(timestamp)) > 300 || !/^v1=[a-f0-9]{64}$/.test(signature))
        return false;
    const expected = Buffer.from(signWebhook(body, timestamp, secret));
    return timingSafeEqual(expected, Buffer.from(signature));
}
