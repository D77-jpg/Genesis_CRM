import { Router, type Request, type Response, type NextFunction } from 'express';
import { rateLimit } from 'express-rate-limit';
import { ZodError } from 'zod';
import { ApiError } from '../utils/ApiError';
import { requireOAuthConfig, oauthStorageReady } from '../services/oauth-core';
import { manageClients, consentData, decide, applications, revokeApplications } from '../services/oauth-management';
const router = Router();
router.use((req, _res, next) => { if (!req.path.startsWith('/auth/oauth/') && !req.path.startsWith('/oauth/clients')) {
    next('router');
    return;
} next(); });
router.use(rateLimit({ windowMs: 60000, limit: 20, standardHeaders: true, legacyHeaders: false, message: { error: 'temporarily_unavailable' } }));
router.use((_req, res, next) => { res.set('Cache-Control', 'no-store').set('Referrer-Policy', 'no-referrer'); try {
    requireOAuthConfig();
    void oauthStorageReady().then(ready => { if (ready)
        next();
    else
        res.status(503).json({ error: 'temporarily_unavailable' }); }).catch(() => res.status(503).json({ error: 'temporarily_unavailable' }));
}
catch {
    res.status(503).json({ error: 'temporarily_unavailable' });
} });
const call = (fn: (req: Request) => Promise<unknown>, status = 200) => (req: Request, res: Response, next: NextFunction) => { void fn(req).then(data => res.status(status).json({ success: true, data })).catch(next); };
router.get('/auth/oauth/interactions/:uid', call(consentData));
router.post('/auth/oauth/interactions/:uid/decision', call(decide));
router.get('/auth/oauth/applications', call(applications));
router.post('/auth/oauth/applications/revoke-all', call(req => revokeApplications(req, true)));
router.post('/auth/oauth/applications/:grantId/revoke', call(req => revokeApplications(req)));
router.get('/oauth/clients', call(req => manageClients(req, 'list')));
router.post('/oauth/clients', call(req => manageClients(req, 'create'), 201));
router.patch('/oauth/clients/:clientId', call(req => manageClients(req, 'patch')));
router.post('/oauth/clients/:clientId/rotate-secret', call(req => manageClients(req, 'rotate')));
router.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const status = error instanceof ZodError ? 400 : error instanceof ApiError ? error.statusCode : 503;
    const codes: Record<number, string> = { 400: 'invalid_request', 401: 'login_required', 403: 'access_denied', 404: 'not_found', 409: 'conflict', 429: 'temporarily_unavailable' };
    res.status(status).json({ error: codes[status] ?? 'temporarily_unavailable' });
});
export default router;
