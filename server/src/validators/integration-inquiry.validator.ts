import { z } from 'zod';
const text = (n: number) => z.string().trim().max(n), id = z.string().regex(/^[a-f0-9]{24}$/), date = z.string().datetime();
const url = text(2000).url().refine(s => { const u = new URL(s); return ['http:', 'https:'].includes(u.protocol) && !u.username && !u.password; });
export const inquiryBody = z.object({
    schemaVersion: z.literal('1.0'), sourceSystem: z.literal('globalsite'), externalInquiryId: text(128).min(1),
    site: z.object({ id: text(128).min(1), name: text(200).min(1) }).strict(), submittedAt: date,
    contact: z.object({ name: text(100).min(1), email: text(200).email().toLowerCase(), phone: text(80), company: text(160), country: text(80) }).strict(),
    products: z.array(z.object({ globalSiteProductId: text(128).min(1), crmProductId: id.nullable(), name: text(200).min(1) }).strict()).max(50),
    quantity: z.number().int().min(1).max(1e9).nullable(), message: text(8000).min(1),
    attachments: z.array(z.object({ id: text(128).min(1), fileName: text(160).min(1), downloadUrl: url, expiresAt: date, mime: z.enum(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']), bytes: z.number().int().min(1).max(2097152), sha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict()).max(3),
    source: z.object({ pageUrl: url, referrer: url.nullable(), utm: z.object({ source: text(200).nullable(), medium: text(200).nullable(), campaign: text(200).nullable(), term: text(200).nullable(), content: text(200).nullable() }).strict(), device: z.enum(['desktop', 'mobile', 'tablet', 'unknown']), firstVisitAt: date.nullable() }).strict(),
    spamScore: z.number().int().min(0).max(100)
}).strict().superRefine((d, c) => { if (new Set(d.attachments.map(a => a.id)).size !== d.attachments.length)
    c.addIssue({ code: 'custom', message: '附件ID重复', path: ['attachments'] }); });
export type InquiryInput = z.infer<typeof inquiryBody>;
