import { createHash } from 'node:crypto';
import { AgentProviderError } from './provider';
type Circuit = {
    failures: number;
    openedAt: number;
    active: number;
    lastUsed: number;
    probe: boolean;
};
const circuits = new Map<string, Circuit>();
const metrics = { requests: 0, failed: 0, rejected: 0, inputTokens: 0, outputTokens: 0, unknownUsage: 0, totalMs: 0, maxMs: 0 };
export function modelTransportStatus() { return { ...metrics, active: [...circuits.values()].reduce((n, c) => n + c.active, 0), openCircuits: [...circuits.values()].filter(c => c.openedAt && Date.now() - c.openedAt < 30000).length, cooldownMs: 30000, maxConcurrent: 4, cost: 'See project quota estimates; transport failures may incur unreported vendor cost' }; }
/** No implicit retry or alternate destination. Durable workflow owns bounded retries. */
export async function guardedModelFetch(url: string, init: RequestInit): Promise<Response> {
    const key = createHash('sha256').update(url + JSON.stringify(init.headers)).digest('hex'), now = Date.now();
    if (!circuits.has(key) && circuits.size >= 64) {
        for (const [k, c] of circuits)
            if (!c.active && now - c.lastUsed > 30000)
                circuits.delete(k);
        if (circuits.size >= 64) {
            metrics.rejected++;
            throw new AgentProviderError('OPENAI_CAPACITY');
        }
    }
    const c = circuits.get(key) ?? { failures: 0, openedAt: 0, active: 0, lastUsed: now, probe: false };
    circuits.set(key, c);
    c.lastUsed = now;
    if (c.openedAt && (now - c.openedAt < 30000 || c.probe)) {
        metrics.rejected++;
        throw new AgentProviderError('OPENAI_CIRCUIT_OPEN');
    }
    if ([...circuits.values()].reduce((n, c) => n + c.active, 0) >= 4) {
        metrics.rejected++;
        throw new AgentProviderError('OPENAI_CAPACITY');
    }
    if (c.openedAt)
        c.probe = true;
    c.active++;
    metrics.requests++;
    let failed = false, usageKnown = false;
    try {
        const response = await fetch(url, init);
        if (Number(response.headers.get('content-length') ?? 0) > 4 * 1024 ** 2) {
            await response.body?.cancel();
            throw new AgentProviderError('OPENAI_RESPONSE_LIMIT');
        }
        const reader = response.body?.getReader();
        let size = 0;
        const parts: Uint8Array[] = [];
        if (reader)
            try {
                while (true) {
                    const part = await reader.read();
                    if (part.done)
                        break;
                    size += part.value.length;
                    if (size > 4 * 1024 ** 2)
                        throw new AgentProviderError('OPENAI_RESPONSE_LIMIT');
                    parts.push(part.value);
                }
            }
            finally {
                await reader.cancel().catch(() => undefined);
            }
        const text = Buffer.concat(parts).toString('utf8');
        let parsed: {
            usage?: {
                input_tokens?: number;
                output_tokens?: number;
            };
            status?: string;
        };
        try {
            parsed = JSON.parse(text);
        }
        catch {
            throw new AgentProviderError('OPENAI_INVALID_RESPONSE');
        }
        if (parsed.usage) {
            const a = parsed.usage.input_tokens, b = parsed.usage.output_tokens;
            if (Number.isSafeInteger(a) && a! >= 0 && Number.isSafeInteger(b) && b! >= 0) {
                metrics.inputTokens += a!;
                metrics.outputTokens += b!;
                usageKnown = true;
            }
        }
        if (!response.ok || parsed.status === 'failed') {
            failed = true;
        }
        if (!failed) {
            c.failures = 0;
            c.openedAt = 0;
        }
        return new Response(text, { status: response.status, headers: { 'content-type': 'application/json' } });
    }
    catch (e) {
        failed = true;
        throw e;
    }
    finally {
        if (!usageKnown)
            metrics.unknownUsage++;
        if (failed) {
            metrics.failed++;
            if (++c.failures >= 3)
                c.openedAt = Date.now();
        }
        c.active--;
        c.probe = false;
        const elapsed = Date.now() - now;
        metrics.totalMs += elapsed;
        metrics.maxMs = Math.max(metrics.maxMs, elapsed);
    }
}
