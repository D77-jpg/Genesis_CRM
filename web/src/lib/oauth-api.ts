import { API_BASE_URL } from './api';
export class OAuthUiError extends Error {
    constructor(readonly status: number, readonly code: string) { super(code); this.name = 'OAuthUiError'; }
}
export async function oauthRequest<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
    const csrf = document.cookie.split(';').map(x => x.trim()).find(x => x.startsWith('cdlm_csrf='))?.slice(10);
    const r = await fetch(API_BASE_URL + path, { method, credentials: 'include', cache: 'no-store', headers: { 'Content-Type': 'application/json', ...(csrf ? { 'X-CSRF-Token': decodeURIComponent(csrf) } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const payload = await r.json() as {
        data: T;
        error?: string;
    };
    if (!r.ok)
        throw new OAuthUiError(r.status, payload.error ?? 'temporarily_unavailable');
    return payload.data;
}
