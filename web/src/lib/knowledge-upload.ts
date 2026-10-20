import type { KnowledgeCategory } from '@/types/knowledge';

export const UNREVIEWED_APPLICABILITY = '适用条件待审核，请对照原文核对产品、数量、费用与有效期。';
export function validateKnowledgeFiles(files: readonly {name: string; size: number}[]): string | null {
  if (files.length > 10) return '每次最多选择 10 份文件';
  for (const file of files) {
    if (!/\.(txt|md|markdown|pdf|docx|xlsx|csv|png|jpe?g)$/i.test(file.name)) return file.name + '：暂不支持此格式，请使用页面列出的文件格式';
    if (!file.size || file.size > 15 * 1024 ** 2) return file.name + '：文件为空或超过 15MB';
  }
  return null;
}
export function knowledgeUploadMetadata(source: string, category: KnowledgeCategory | '') {
  return {...(source.trim() ? {source: source.trim()} : {}), ...(category ? {category} : {})};
}
