/**
 * Public one-click unsubscribe endpoint.
 *
 * The URL is signed and scoped to one project + recipient. GET shows a
 * confirmation page; POST is the RFC 8058 one-click action used by mailbox
 * providers. No authentication or project context is accepted from the caller.
 */
import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { Types } from 'mongoose';
import { Customer, DevelopmentLetter, Project } from '../models';
import { parseUnsubscribeToken, suppressEmail } from '../services/mail-compliance.service';
import { runWithTenant } from '../models/tenant-context';

const router = Router();
const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false });

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char] ?? char));
}

async function applyUnsubscribe(token: string): Promise<{ email: string; projectId: string } | null> {
  const target = parseUnsubscribeToken(token);
  if (!target) return null;
  const project = await Project.findById(target.projectId).select('organizationId').lean();
  if (!project) return null;
  return runWithTenant({
    organizationId: project.organizationId ? String(project.organizationId) : undefined,
    bypass: false,
    source: 'public-unsubscribe',
  }, async () => {
    await suppressEmail({
      projectId: target.projectId,
      email: target.email,
      reason: 'unsubscribe',
      source: 'link',
      note: 'One-click unsubscribe',
      global: true,
    });
    const projectId = new Types.ObjectId(target.projectId);
    await Promise.all([
      Customer.updateOne(
        { projectId, email: target.email },
        { $set: { outreachAbandonedAt: new Date(), nextFollowUpAt: null } },
      ),
      DevelopmentLetter.updateMany(
        { projectId, recipientEmail: target.email, status: { $in: ['queued', 'scheduled', 'retrying'] } },
        { $set: { status: 'cancelled', error: '收件人已退订，取消待发送邮件' } },
      ),
    ]);
    return target;
  });
}

function page(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title></head>`
    + `<body style="font-family:Arial,Helvetica,sans-serif;max-width:36rem;margin:4rem auto;padding:0 1.25rem;color:#111827;line-height:1.6">`
    + `<h1 style="font-size:1.35rem">${escapeHtml(title)}</h1>${body}</body></html>`;
}

router.get('/:token', limiter, async (req, res) => {
  const target = parseUnsubscribeToken(req.params.token);
  if (!target) {
    res.status(404).type('html').send(page('Unsubscribe link is invalid', '<p>This link is invalid or has expired. Please contact the sender directly.</p>'));
    return;
  }
  res.type('html').send(page(
    'Unsubscribe from future outreach',
    `<p>Stop future marketing emails to <strong>${escapeHtml(target.email)}</strong>?</p>`
      + `<form method="post" action=""><button type="submit" style="padding:.65rem 1rem;border:0;border-radius:.375rem;background:#111827;color:#fff;cursor:pointer">Confirm unsubscribe</button></form>`
      + '<p style="color:#6b7280;font-size:.85rem">This only stops marketing outreach. Replies to an active conversation may still be sent.</p>',
  ));
});

router.post('/:token', limiter, async (req, res) => {
  const target = await applyUnsubscribe(req.params.token);
  if (!target) {
    res.status(404).type('text').send('Invalid unsubscribe link');
    return;
  }
  res.type('html').send(page(
    'You have been unsubscribed',
    `<p><strong>${escapeHtml(target.email)}</strong> has been added to the global do-not-contact list.</p>`,
  ));
});

export default router;
