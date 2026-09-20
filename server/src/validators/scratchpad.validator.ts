import { z } from 'zod';
import { SCRATCHPAD_MAX_LENGTH } from '../models/Scratchpad';

export const updateScratchpadSchema = z.object({
  content: z
    .string({ required_error: '随手记内容不能为空' })
    .max(SCRATCHPAD_MAX_LENGTH, `随手记不能超过 ${SCRATCHPAD_MAX_LENGTH} 个字符`),
  expectedVersion: z.number().int().min(0, '版本号不能小于 0'),
});

export type UpdateScratchpadInput = z.infer<typeof updateScratchpadSchema>;
