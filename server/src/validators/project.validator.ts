import { z } from 'zod';

const projectFields = {
  name: z.string().trim().min(1).max(120),
  slug: z.string().trim().toLowerCase().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(80),
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_-]+$/).max(30),
  industry: z.string().trim().max(120).optional().default(''),
  companyName: z.string().trim().min(1).max(200),
  website: z.string().trim().max(300).optional().default(''),
  moq: z.string().trim().max(120).optional().default(''),
  senderName: z.string().trim().max(120).optional().default(''),
  mailFrom: z.string().trim().max(300).optional().default(''),
  mailProfileKey: z.string().trim().toLowerCase().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(80),
};

export const createProjectSchema = z.object(projectFields);
export const updateProjectSchema = z.object({
  name: projectFields.name.optional(),
  industry: projectFields.industry,
  companyName: projectFields.companyName.optional(),
  website: projectFields.website,
  moq: projectFields.moq,
  senderName: projectFields.senderName,
  mailFrom: projectFields.mailFrom,
  mailProfileKey: projectFields.mailProfileKey.optional(),
  status: z.enum(['active', 'archived']).optional(),
}).refine((value) => Object.keys(value).length > 0, '至少提供一个更新字段');

export type CreateProjectInput = z.infer<typeof createProjectSchema>;
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;
