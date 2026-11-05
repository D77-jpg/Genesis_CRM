import { z } from 'zod';

export const readFeedQuery = z.object({
  updatedSince: z.string().datetime().optional(),
  cursor: z.string().min(1).max(2048).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
}).strict();
export type ReadFeedQuery = z.infer<typeof readFeedQuery>;
export const readProductParams = z.object({ id: z.string().regex(/^[a-f\d]{24}$/i) });
export const readImageParams = readProductParams.extend({ imageId: z.string().regex(/^[a-f\d]{24}$/i) });
export const readImageQuery = z.object({
  expires: z.coerce.number().int().positive(),
  signature: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();

const text = z.string().trim().min(1).max(2000);
const marked = z.object({ value: text, visibility: z.enum(['public', 'internal']) }).strict();
export const publicImageInput = z.object({ key: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,199}$/) }).strict();
export const publicPayloads = {
  product: z.object({
    material: text.optional(), application: text.optional(),
    certifications: z.array(text).max(50).default([]),
    images: z.array(publicImageInput).max(20).default([]),
  }).strict(),
  company: z.object({
    address: text.optional(), phone: text.optional(), email: z.string().email().max(200).optional(),
    foundedYear: z.number().int().min(1000).max(9999).optional(), capacity: text.optional(),
    certifications: z.array(text).max(50).default([]),
  }).strict(),
  playbook: z.object({
    brandPositioning: marked.optional(), sellingPoints: z.array(marked).max(50).default([]),
    targetMarkets: z.array(marked).max(50).default([]),
  }).strict(),
  knowledge: z.object({ title: text, summary: z.string().trim().min(1).max(4000) }).strict(),
};
