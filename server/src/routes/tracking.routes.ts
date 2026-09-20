import { Router } from 'express';
import { asyncHandler } from '../utils/asyncHandler';
import { recordClick, recordOpen } from '../services/mail-tracking.service';

const router = Router();

// 43-byte base64url token plus an optional .gif suffix. Invalid tokens return the
// same transparent pixel so callers cannot use status codes to enumerate mail.
const PIXEL = Buffer.from('R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==', 'base64');
router.get('/o/:token', asyncHandler(async (req, res) => {
  const token = req.params.token.replace(/\.gif$/i, '');
  try { await recordOpen(token, req); } catch { /* tracking must never break image loading */ }
  res.setHeader('Content-Type', 'image/gif');
  res.setHeader('Content-Length', String(PIXEL.length));
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.status(200).send(PIXEL);
}));

router.get('/c/:token', asyncHandler(async (req, res) => {
  const target = await recordClick(req.params.token, req);
  if (!target) {
    res.setHeader('Cache-Control', 'no-store');
    res.status(404).type('text/plain').send('链接不存在或已失效');
    return;
  }
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.redirect(302, target);
}));

export default router;
