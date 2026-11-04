import { z } from 'zod';

export const brandProfileSchema = z.object({
  label: z.string().trim().max(200).optional(),
  identity: z.string().trim().max(500).optional(),
  offerSummary: z.string().trim().max(2000).optional(),
  outreachFocus: z.string().trim().max(1000).optional(),
  avoidTopics: z.string().trim().max(1000).optional(),
  insightLabel: z.string().trim().max(200).optional(),
  insightExamples: z.string().trim().max(2000).optional(),
  proofExamples: z.string().trim().max(3000).optional(),
  ctaExamples: z.string().trim().max(1000).optional(),
  subjectFocus: z.string().trim().max(300).optional(),
  signatureTitle: z.string().trim().max(300).optional(),
  signatureLines: z.array(z.string().trim().max(500)).max(12).optional(),
}).strict();

export const mailComplianceSchema = z.object({
  warmupEnabled: z.boolean(),
  warmupStartedAt: z.coerce.date().optional(),
  warmupStartLimit: z.number().int().min(1).max(5000),
  warmupDailyIncrement: z.number().int().min(1).max(1000),
  warmupMaxLimit: z.number().int().min(1).max(10000),
  dailySendLimit: z.number().int().min(1).max(10000),
  trackingEnabled: z.boolean().optional(),
}).strict();

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
  /** 项目级真实发送开关；不传时沿用服务端配置 */
  mailTransport: z.enum(['mock', 'smtp']).optional(),
  // Browser-compressed data URL (<=600k chars) or an https URL; '' clears it.
  logoImage: z.string().max(600000).optional(),
  coverImage: z.string().max(600000).optional(),
  brandProfile: brandProfileSchema.optional(),
  mailCompliance: mailComplianceSchema.optional(),
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
  mailTransport: projectFields.mailTransport,
  logoImage: projectFields.logoImage,
  coverImage: projectFields.coverImage,
  brandProfile: projectFields.brandProfile,
  mailCompliance: projectFields.mailCompliance,
  status: z.enum(['active', 'archived']).optional(),
}).refine((value) => Object.keys(value).length > 0, '至少提供一个更新字段');

export type CreateProjectInput = z.infer<typeof createProjectSchema>;
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;
