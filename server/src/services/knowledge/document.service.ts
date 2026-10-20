import {stopParserProcesses} from './parser-process';
import { createHash, randomUUID } from 'node:crypto';
import mongoose, { Types } from 'mongoose';
import { z } from 'zod';
import { KnowledgeBlob, KnowledgeChunk, KnowledgeDocument, KnowledgeParsing } from '../../models/KnowledgeDocument';
import { AgentKnowledge } from '../../models/AgentKnowledge';
import { User, Project } from '../../models';
import type { AuthUser } from '../../types/express';
import { requireProjectId } from '../../utils/access';
import { ApiError } from '../../utils/ApiError';
import { appendKnowledge, policyTopics } from '../agent/knowledge.service';
import { knowledgeIndexChanged } from './index.service';
import { KNOWLEDGE_CATEGORIES } from '../agent/knowledge-types';
import { configHash, parserConfig, parserIdentity, PARSER_VERSION, ParserError, runParser } from './parser-process';

const formats: Record<string, string> = { txt: 'text/plain', md: 'text/markdown', markdown: 'text/markdown', pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', csv: 'text/csv', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg' };
export const uploadInput = z.object({ fileName: z.string().min(1).max(180), data: z.string().min(4).max(20971520),
  source: z.string().trim().min(1).max(350).optional(), category: z.enum(KNOWLEDGE_CATEGORIES).optional() }).strict();
const reviewedDraftInput = z.object({ title: z.string().trim().min(1).max(160), content: z.string().trim().min(1).max(12000),
  category: z.enum(KNOWLEDGE_CATEGORIES), applicability: z.string().trim().min(1).max(1000) }).strict();
// Uploading a file and staging its text require no policy form or publication decision.
export const reviewInput = reviewedDraftInput.partial();
export const UNREVIEWED_APPLICABILITY = '适用条件待审核，请对照原文核对产品、数量、费用与有效期。';
// Whole-document collection: one file becomes one reviewable entry, not one per
// parser paragraph. Long files are split at section boundaries, never truncated.
export const collectInput = z.object({ title: z.string().trim().min(1).max(160).optional(),
  category: z.enum(KNOWLEDGE_CATEGORIES).optional(), products: z.array(z.string().trim().min(1).max(100)).max(20).optional(),
  applicability: z.string().trim().min(1).max(1000).optional(), source: z.string().trim().min(1).max(500).optional(),
  publish: z.boolean().default(true) }).strict();
export const COLLECTION_APPLICABILITY = '参考资料；对外报价、交期、认证等承诺须按已确认的条件使用。';
const PART_CHARS = 11000;
const HORIZONTAL_RULE = /^\s*(?:[-*_]\s*){3,}$/;
export const digest = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');
const id = (value: string) => { if (!Types.ObjectId.isValid(value)) throw ApiError.notFound('资料不存在或无权访问'); return value; };
function admin(actor: AuthUser) { requireProjectId(actor); if (actor.role !== 'admin') throw ApiError.forbidden('原文与解析建议仅供项目管理员审核'); }
const scope = (actor: AuthUser) => ({ projectId: requireProjectId(actor) });

async function currentActor(projectId: Types.ObjectId, userId: Types.ObjectId): Promise<AuthUser> {
  const [user, project] = await Promise.all([User.findById(userId), Project.findById(projectId)]);
  if (!user || user.status === 'disabled' || user.role !== 'admin' || project?.status !== 'active') throw new ParserError('authority_revoked', '任务发起人的权限或项目状态已变化，请由管理员重新发起');
  return { id: user.id, username: user.username, displayName: user.displayName, role: 'admin', projectId: String(projectId) };
}

async function enqueue(document: InstanceType<typeof KnowledgeDocument>, actor: AuthUser, revision: number) {
  // The worker verifies current runtime identity again before accepting artifacts.
  const identity = await parserIdentity();
  const pinnedConfig = digest(JSON.stringify({ configHash, ...identity }));
  try {
    return await KnowledgeParsing.findOneAndUpdate({ documentId: document._id, revision }, { $setOnInsert: {
      ...scope(actor), documentId: document._id, requestedBy: actor.id, revision, parserVersion: PARSER_VERSION,
      configHash: pinnedConfig, state: 'queued', stage: '等待本地解析',
    } }, { upsert: true, new: true });
  } catch (e) { if ((e as { code?: number }).code !== 11000) throw e; return KnowledgeParsing.findOne({ documentId: document._id, revision }); }
}

export async function uploadDocument(input: z.infer<typeof uploadInput>, actor: AuthUser) {
  admin(actor); await Promise.all([KnowledgeDocument.init(),KnowledgeBlob.init(),KnowledgeParsing.init(),KnowledgeChunk.init()]); const value = uploadInput.parse(input);
  if (/[\\/\x00-\x1f]/.test(value.fileName)) throw ApiError.badRequest('文件名不能含路径或控制字符');
  const extension = value.fileName.split('.').at(-1)!.toLowerCase();
  if (!formats[extension]) throw ApiError.badRequest('请选择 TXT、Markdown、PDF、DOCX、XLSX、CSV、PNG 或 JPEG');
  if (value.data.length%4!==0 || /[^A-Za-z0-9+/=]/.test(value.data)) throw ApiError.badRequest('文件数据编码无效');
  const data = Buffer.from(value.data, 'base64');
  if(data.toString('base64')!==value.data)throw ApiError.badRequest('文件数据编码无效');
  if (!data.length || data.length > parserConfig.maxBytes) throw ApiError.badRequest('文件为空或超过 15MB');
  const sha256 = digest(data);
  let existing = await KnowledgeDocument.findOne({ ...scope(actor), sha256, kind: 'project_document' });
  if (existing) {
    // Repair a possible crash between immutable source insert and task creation.
    if (!await KnowledgeParsing.exists({ documentId: existing._id })) await enqueue(existing, actor, 1);
    return { id: existing.id, duplicate: true };
  }
  let blob;
  try { blob = await KnowledgeBlob.findOneAndUpdate({ ...scope(actor), sha256 }, { $setOnInsert: { ...scope(actor), sha256, data } }, { new: true, upsert: true }); }
  catch (e) { if ((e as { code?: number }).code !== 11000) throw e; blob = await KnowledgeBlob.findOne({ ...scope(actor), sha256 }); }
  try { existing = await KnowledgeDocument.create({ ...scope(actor), kind: 'project_document', originalName: value.fileName, extension,
    mime: formats[extension], bytes: data.length, sha256, blobKey: blob!._id, uploadedBy: actor.id, source: value.source ?? value.fileName, category: value.category ?? 'pending' }); }
  catch (e) { if ((e as { code?: number }).code !== 11000) throw e; existing = await KnowledgeDocument.findOne({ ...scope(actor), sha256, kind: 'project_document' }); }
  if (!existing) throw ApiError.internal('原文保存失败');
  await enqueue(existing, actor, 1);
  return { id: existing.id, duplicate: false };
}

export async function listDocuments(actor: AuthUser, before?: string) {
  admin(actor);
  const documents = await KnowledgeDocument.find({ ...scope(actor), ...(before ? { _id: { $lt: id(before) } } : {}) }).sort({ _id: -1 }).limit(30).lean();
  const result = [];
  for (const d of documents) {
    const parsing = await KnowledgeParsing.findOne({ documentId: d._id, ...scope(actor) }).sort({ revision: -1 }).lean();
    const linked=await AgentKnowledge.find({...scope(actor),'revisions.sourceRefs.documentId':String(d._id)}).lean();
    const matchesDoc=(v:{sourceRefs?:Record<string,unknown>[]}|undefined)=>v?.sourceRefs?.some(ref=>String(ref.documentId)===String(d._id));
    const related=linked.flatMap(k=>k.revisions.filter(v=>(v.version===k.version||v.version===k.approvedVersion)&&matchesDoc(v)).map(v=>({v,archived:k.archived,published:v.version===k.approvedVersion})));
    const products=[...new Set(related.flatMap(({v})=>v.products??[]))];
    const current=related.filter(x=>!x.archived&&x.published);
    const effective=current.some(({v})=>!!v.validFrom&&v.validFrom<=new Date()&&(!v.validUntil||v.validUntil>new Date()));
    const expires=current.flatMap(({v})=>v.validUntil?[v.validUntil]:[]);
    const validity=effective?(expires.some(d=>d>new Date()&&d<=new Date(Date.now()+30*86400000))?'expiring':'active'):expires.some(d=>d<=new Date())?'expired':'unconfirmed';
    const reviewState=current.length?'published':related.some(x=>!x.archived)?'draft':related.length?'disabled':'unreviewed';
    // Surface the actual advisories (mostly per-paragraph) instead of a vague "partial".
    const chunkWarnings = parsing ? await KnowledgeChunk.distinct('warnings', { ...scope(actor), documentId: d._id, parsingRevisionId: parsing._id, artifactHash: parsing.artifactHash }) as string[] : [];
    result.push({products,reviewState,validity, ...d, id: String(d._id), blobKey: undefined,
      parsing: parsing ? { ...parsing, id: String(parsing._id), artifact: undefined, leaseToken: undefined,
        warnings: [...new Set([...(parsing.warnings ?? []), ...chunkWarnings])] } : null });
  }
  return { documents: result, next: documents.length === 30 ? String(documents.at(-1)!._id) : null };
}

export async function documentDetail(documentId: string, actor: AuthUser, page = 0, revisionId?: string,chunkId?:string) {
  admin(actor);
  const doc = await KnowledgeDocument.findOne({ _id: id(documentId), ...scope(actor) }).lean();
  if (!doc) throw ApiError.notFound('资料不存在或无权访问');
  const revisions = await KnowledgeParsing.find({ documentId: doc._id, ...scope(actor) }).sort({ revision: -1 }).lean();
  const latest = revisionId ? revisions.find(r => String(r._id) === id(revisionId)) : revisions[0];
  if(revisionId&&!latest)throw ApiError.notFound('解析版本不存在或无权访问');
  if(chunkId){const target=await KnowledgeChunk.findOne({_id:chunkId,...scope(actor),documentId:doc._id,parsingRevisionId:latest?._id,artifactHash:latest?.artifactHash}).lean();if(!target)throw ApiError.notFound('引用片段不存在于该解析版本');page=Math.floor((target.ordinal??0)/20);}
  const chunks = latest && ['succeeded', 'partial'].includes(latest.state)
    ? await KnowledgeChunk.find({ ...scope(actor), parsingRevisionId: latest._id, artifactHash: latest.artifactHash }).sort({ ordinal: 1 }).skip(page * 20).limit(20).lean() : [];
  const keys = chunks.map(c => 'document-chunk:' + c._id);
  const saved = await AgentKnowledge.find({ ...scope(actor), importKey: { $in: keys } }).select('_id importKey').lean();
  return { document: { ...doc, id: String(doc._id), blobKey: undefined },
    revisions: revisions.map(r => ({ ...r, id: String(r._id), leaseToken: undefined })), page,
    chunks: chunks.map(c => ({ ...c, id: String(c._id), draftId: String(saved.find(k => k.importKey === 'document-chunk:' + c._id)?._id ?? ''),
      suggestions: policyTopics(c.content ?? '').map(topic => ({ topic, mode: 'needs_confirmation', text: '请核对原文中的值、币种、单位、适用产品和条件，不能直接作为政策。' })) })) };
}

export async function originalDocument(documentId: string, actor: AuthUser) {
  admin(actor); const doc = await KnowledgeDocument.findOne({ _id: id(documentId), ...scope(actor) });
  if (!doc) throw ApiError.notFound();
  if(!await KnowledgeParsing.exists({documentId:doc._id,projectId:doc.projectId,state:{$in:['succeeded','partial']}}))throw ApiError.conflict('资料尚未通过安全校验，原文已隔离；请核对本机文件或重新导出后上传');
  const blob = await KnowledgeBlob.findOne({ _id: doc.blobKey, ...scope(actor), sha256: doc.sha256 }).select('+data');
  if (!blob?.data) throw ApiError.notFound('原文数据缺失，请联系管理员恢复备份');
  const bytes = Buffer.from(blob.data);
  if (digest(bytes) !== doc.sha256) throw ApiError.conflict('原文完整性校验失败');
  return { bytes, name: doc.originalName };
}

export async function controlParsing(parsingId: string, action: 'cancel' | 'retry', actor: AuthUser) {
  admin(actor);
  const parsing = await KnowledgeParsing.findOne({ _id: id(parsingId), ...scope(actor) });
  if (!parsing) throw ApiError.notFound();
  if (action === 'cancel') {
    const cancelled = await KnowledgeParsing.updateOne({ _id: parsing._id, state: { $in: ['queued', 'running'] } }, { $set: { state: 'cancelled', stage: '已取消' }, $unset: { leaseToken: 1, leaseUntil: 1 } });
    if(!cancelled.matchedCount)throw ApiError.conflict('任务已结束，请刷新后查看结果');
    return { cancelled: true };
  }
  const latest = await KnowledgeParsing.findOne({ documentId: parsing.documentId }).sort({ revision: -1 });
  if (!latest || latest.id !== parsing.id) throw ApiError.conflict('已有新解析版本，请刷新后查看');
  if (['queued', 'running'].includes(parsing.state)) throw ApiError.conflict('请等待当前任务或先取消');
  const doc = await KnowledgeDocument.findOne({ _id: parsing.documentId, ...scope(actor) });
  if (!doc || doc.kind === 'legacy_inline') throw ApiError.badRequest('历史正文快照不需要重新解析');
  const next = await enqueue(doc, actor, parsing.revision + 1);
  return { id: next!.id };
}

export async function saveChunkDraft(chunkId: string, input: z.infer<typeof reviewInput>, actor: AuthUser) {
  admin(actor); const overrides = reviewInput.parse(input);
  if (!/^[a-f0-9]{64}$/.test(chunkId)) throw ApiError.notFound();
  const chunk = await KnowledgeChunk.findOne({ _id: chunkId, ...scope(actor) });
  if (!chunk) throw ApiError.notFound();
  const parsing = await KnowledgeParsing.findOne({ _id: chunk.parsingRevisionId, ...scope(actor), state: { $in: ['succeeded', 'partial'] }, artifactHash: chunk.artifactHash });
  const doc = await KnowledgeDocument.findOne({ _id: chunk.documentId, ...scope(actor) });
  if (!parsing || !doc) throw ApiError.conflict('解析结果尚未就绪');
  const importKey = 'document-chunk:' + chunkId;
  const existing = await AgentKnowledge.findOne({ ...scope(actor), importKey });
  if (existing) return { id: existing.id, duplicate: true };
  // Preserve the full source text and conditions; overlong content must be edited, never truncated.
  const reviewed = reviewedDraftInput.parse({
    title: (chunk.headingPath?.join(' / ') || doc.originalName).slice(0, 160),
    content: chunk.content,
    category: KNOWLEDGE_CATEGORIES.includes(doc.category as typeof KNOWLEDGE_CATEGORIES[number]) ? doc.category : 'product',
    applicability: UNREVIEWED_APPLICABILITY,
    ...overrides,
  });
  try {
    const knowledgeId = await appendKnowledge(undefined, { ...reviewed, source: (doc.source === doc.originalName ? doc.originalName : `${doc.source} · ${doc.originalName}`).slice(0, 500),
      expectedVersion: 0, approved: false, tags: [], products: [], terms: [] }, actor, importKey,
    [{ documentId: doc.id, parsingRevisionId: parsing.id, chunkId, contentHash: chunk.contentHash, location: chunk.location,
      parserVersion: parsing.parserVersion, artifactHash: parsing.artifactHash, originalSha256: doc.sha256 }]);
    return { id: knowledgeId, duplicate: false };
  } catch (e) {
    if ((e as { code?: number }).code !== 11000) throw e;
    return { id: (await AgentKnowledge.findOne({ ...scope(actor), importKey }))!.id, duplicate: true };
  }
}

type ChunkRow = { _id: string; content?: string; headingPath?: string[]; contentHash?: string; location?: Record<string, unknown>; warnings?: string[]; headers?: string[]; table?: unknown };
type CollectionPart = { content: string; chunks: ChunkRow[] };

function chunkRef(chunk: ChunkRow, parsing: { id: string; parserVersion: string; artifactHash?: string | null }, doc: { id: string; sha256: string }) {
  return { documentId: doc.id, parsingRevisionId: parsing.id, chunkId: chunk._id, contentHash: chunk.contentHash ?? '',
    location: chunk.location ?? {}, parserVersion: parsing.parserVersion, artifactHash: parsing.artifactHash, originalSha256: doc.sha256 };
}

// Paragraph-level parser chunks are retrieval provenance, not human review units.
// Join them back into readable text. Markdown tables arrive one row per chunk,
// each repeating the header and the same footnote block; rebuild one table.
type TextBlock = { content: string; chunks: ChunkRow[] };

function splitBlock(text: string) {
  const pieces: string[] = [];
  let current = '';
  for (const line of text.split('\n')) {
    if (current.length + line.length + 1 > PART_CHARS) { if (current) pieces.push(current); current = ''; }
    current += (current ? '\n' : '') + line;
  }
  if (current) pieces.push(current);
  return pieces;
}

const tableCell = (value: string) => value.replace(/\|/g, '\\|').replace(/\s*\n\s*/g, '<br>').trim();
const tableNotes = (notes: unknown) => Array.isArray(notes) ? (notes as unknown[]).filter(n => typeof n === 'string').join('\n') : '';

// Markdown tables carry headerText/rowText; Word tables carry cell arrays.
// Both arrive one row per chunk and repeat their notes, so normalise them here.
function tableRowBlock(chunk: ChunkRow): { key: string; rows: string[]; notes: string } | null {
  const meta = chunk.table as { headerText?: string; rowText?: string; headers?: unknown; rows?: unknown; notes?: unknown } | undefined;
  if (meta?.headerText && meta.rowText) {
    const header = meta.headerText.trim();
    const lines = chunk.content!.trim().split('\n');
    const columns = Math.max(header.split('|').length - 2, 1);
    const separator = lines[1] && /^[\s|:-]+$/.test(lines[1].trim()) && lines[1].includes('-') ? lines[1].trim() : '| ' + Array.from({ length: columns }, () => '---').join(' | ') + ' |';
    return { key: header, rows: [header, separator, meta.rowText.trim()], notes: tableNotes(meta.notes) };
  }
  const headers = meta?.headers, rows = meta?.rows;
  if (Array.isArray(headers) && headers.length > 1 && headers.every(cell => typeof cell === 'string') && Array.isArray(rows) && Array.isArray(rows[0])) {
    const cells = headers as string[];
    const row = rows[0] as unknown[];
    if (!row.every(cell => typeof cell === 'string')) return null;
    return { key: 'grid:' + cells.join('\u0001'), rows: ['| ' + cells.map(tableCell).join(' | ') + ' |', '| ' + cells.map(() => '---').join(' | ') + ' |', '| ' + (row as string[]).map(tableCell).join(' | ') + ' |'], notes: tableNotes(meta?.notes) };
  }
  return null;
}

function collectionBlocks(chunks: ChunkRow[]): TextBlock[] {
  const usable = chunks.filter(c => typeof c.content === 'string' && c.content.trim() && !HORIZONTAL_RULE.test(c.content.trim()));
  const blocks: TextBlock[] = [];
  let table: { key: string; head: string[]; rows: string[]; notes: string; noteChunk?: ChunkRow; chunks: ChunkRow[] } | null = null;
  const flush = () => {
    if (!table) return;
    // Notes are a separate paragraph: inside the table they would be read as a
    // one-cell row (GFM continues a table until a blank line).
    blocks.push({ content: [...table.head, ...table.rows].join('\n'), chunks: table.chunks });
    if (table.notes) blocks.push({ content: table.notes, chunks: table.noteChunk ? [table.noteChunk] : table.chunks.slice(0, 1) });
    table = null;
  };
  for (const chunk of usable) {
    const part = tableRowBlock(chunk);
    if (part) {
      if (table && table.key !== part.key) flush();
      if (!table) table = { key: part.key, head: part.rows.slice(0, 2), rows: [], notes: part.notes, noteChunk: chunk, chunks: [] };
      table.rows.push(part.rows[part.rows.length - 1]);
      table.chunks.push(chunk);
    } else {
      flush();
      blocks.push({ content: chunk.content!.trim(), chunks: [chunk] });
    }
  }
  flush();
  // The parser attaches the paragraph after a table to every row as a footnote,
  // while the same paragraph also exists as its own chunk: keep the first copy.
  const seen = new Set<string>();
  return blocks.filter(block => {
    const key = block.content.replace(/\s+/g, ' ').trim();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function collectionParts(chunks: ChunkRow[]): CollectionPart[] {
  const parts: CollectionPart[] = [];
  let current: ChunkRow[] = [], text = '';
  const push = () => { if (current.length) { parts.push({ content: text.trim(), chunks: current }); current = []; text = ''; } };
  for (const block of collectionBlocks(chunks)) {
    for (const piece of splitBlock(block.content)) {
      if (text.length + piece.length + 2 > PART_CHARS) push();
      text += (text ? '\n\n' : '') + piece;
      current.push(...block.chunks);
    }
  }
  push();
  return parts;
}

const cellText = (value: string) => value.replace(/\s*\[格式:\s*[^\]]*\]/g, '').replace(/\s+/g, ' ').trim();

function tableRowOf(chunk: ChunkRow): string[] | null {
  const rows = (chunk.table as { rows?: unknown } | undefined)?.rows;
  const row = Array.isArray(rows) ? rows[0] : undefined;
  if (!Array.isArray(row) || !row.length || !row.every(cell => typeof cell === 'string')) return null;
  return row as string[];
}

// Spreadsheets are rows, not prose: "id | type | ..." repeated for every record
// reads like a wall of pipes. Turn each record into a small section with the
// row's own column labels, so both the review sheet and the sales library stay
// readable. Falls back to plain text when the file carries no table metadata.
function rowBlock(labels: string[], row: string[], index: number) {
  const cells = row.map(cellText);
  // Prefer a human-readable title: a short-to-medium cell, never a formula dump.
  const titled = cells.findIndex(cell => cell.length >= 8 && cell.length <= 80 && !cell.startsWith('['));
  const titleIndex = titled >= 0 ? titled : 0;
  const title = cells[titleIndex] || '第 ' + (index + 1) + ' 条';
  const lines = ['### ' + title];
  cells.forEach((cell, position) => {
    if (position === titleIndex || !cell) return;
    lines.push('- ' + (labels[position] || '第 ' + (position + 1) + ' 列') + '：' + cell);
  });
  return lines.join('\n');
}

function tabularParts(chunks: ChunkRow[]): CollectionPart[] | null {
  let labels: string[] | null = null, sheet = '', records = 0;
  const blocks: { chunk: ChunkRow; text: string }[] = [];
  const preamble: ChunkRow[] = [];
  for (const chunk of chunks) {
    const row = tableRowOf(chunk);
    const chunkSheet = String((chunk.location as { sheet?: string } | undefined)?.sheet ?? '');
    if (row && row.length > 1 && chunkSheet && sheet && chunkSheet !== sheet) {
      // A new worksheet restarts the column labels.
      labels = null;
      blocks.push({ chunk, text: '## ' + chunkSheet });
    }
    if (row) sheet = chunkSheet || sheet;
    if (!row || row.length < 2) { preamble.push(chunk); continue; }
    if (!labels) {
      if (chunk.headers && chunk.headers.length === row.length && chunk.headers.length > 1) {
        labels = chunk.headers.map(cellText);
      } else {
        labels = row.map(cellText);
        continue;
      }
    }
    if (row.length === labels.length && row.every((cell, position) => cellText(cell) === labels![position])) continue;
    records++;
    blocks.push({ chunk, text: rowBlock(labels, row, records) });
  }
  if (!labels || !blocks.length) return null;
  // Leading title / warning rows: drop the repeated sheet title and duplicates.
  const introLines: string[] = [];
  for (const chunk of preamble) for (const line of (chunk.content ?? '').split('\n').map(cellText).filter(Boolean)) {
    if (!introLines.includes(line)) introLines.push(line);
  }
  let intro = introLines.join('\n\n');
  if (intro.length > 1500) {
    const cut = intro.lastIndexOf('\n\n', 1500);
    intro = (cut > 300 ? intro.slice(0, cut) : intro.slice(0, 1500)).trimEnd() + '\n\n…';
  }
  const parts: CollectionPart[] = [];
  let current: ChunkRow[] = intro ? [...preamble] : [], text = intro;
  const flush = () => { if (current.length && text.trim()) parts.push({ content: text.trim(), chunks: current }); current = []; text = ''; };
  for (const block of blocks) {
    if (text.length + block.text.length + 2 > PART_CHARS) flush();
    text += (text ? '\n\n' : '') + block.text;
    current.push(block.chunk);
  }
  flush();
  return parts.length ? parts : null;
}

function suggestedTitle(parts: CollectionPart[], doc: { originalName: string }) {
  const chunks = parts.flatMap(part => part.chunks);
  // A table header can start with "#" (the first column is literally "#"), so
  // never treat a line containing "|" as a heading.
  const heading = chunks.map(chunk => chunk.content?.trim() ?? '').find(text => /^#{1,6}\s+\S/.test(text) && !text.includes('|') && text.length <= 120);
  // Sheet names such as "CSV" / "Sheet1" are parser labels, not titles.
  const path = chunks.map(chunk => chunk.headingPath?.[0]?.trim()).find((value): value is string => !!value && value.length >= 4 && !/^(csv|tsv|sheet\s*\d*|table\s*\d*|表格\s*\d*)$/i.test(value));
  const filename = doc.originalName.replace(/\.[^.]+$/, '').replace(/^\s*\d+\s*[-_.、]\s*/, '');
  const title = heading ? heading.replace(/^#{1,6}\s+/, '') : path ?? filename;
  return title.replace(/\s+/g, ' ').trim().slice(0, 160) || '未命名资料';
}

function defaultCategory(doc: { category?: string | null }) {
  return KNOWLEDGE_CATEGORIES.includes(doc.category as typeof KNOWLEDGE_CATEGORIES[number]) ? doc.category as typeof KNOWLEDGE_CATEGORIES[number] : 'reference';
}

async function collectionSource(documentId: string, actor: AuthUser) {
  const doc = await KnowledgeDocument.findOne({ _id: id(documentId), ...scope(actor) }).lean();
  if (!doc) throw ApiError.notFound('资料不存在或无权访问');
  const parsing = await KnowledgeParsing.findOne({ documentId: doc._id, ...scope(actor) }).sort({ revision: -1 }).lean();
  if (!parsing || !['succeeded', 'partial'].includes(parsing.state)) throw ApiError.conflict('文件还没有解析完成，请稍后再试');
  const chunks = await KnowledgeChunk.find({ ...scope(actor), parsingRevisionId: parsing._id, artifactHash: parsing.artifactHash }).sort({ ordinal: 1 }).lean() as unknown as ChunkRow[];
  const parts = ['csv', 'xlsx'].includes(doc.extension) ? (tabularParts(chunks) ?? collectionParts(chunks)) : collectionParts(chunks);
  if (!parts.length) throw ApiError.conflict('这份文件没有可用的文字内容，请检查解析结果');
  // lean() drops virtuals: rebuild the parsing identity explicitly.
  const persisted = { id: String(parsing._id), parserVersion: parsing.parserVersion, artifactHash: parsing.artifactHash, warnings: parsing.warnings ?? [] };
  return { doc, docId: String(doc._id), parsing: persisted, parts };
}

type ParsingRow = { id: string; parserVersion: string; artifactHash?: string | null; warnings?: string[] | null };
const partRefs = (part: CollectionPart, parsing: ParsingRow, doc: { id: string; sha256: string }) => part.chunks.map(chunk => chunkRef(chunk, parsing, doc));

export async function previewCollection(documentId: string, actor: AuthUser) {
  admin(actor);
  const { doc, parsing, parts } = await collectionSource(documentId, actor);
  const notes = [...new Set([...(parsing.warnings ?? []), ...parts.flatMap(part => part.chunks.flatMap(chunk => chunk.warnings ?? []))])];
  return { title: suggestedTitle(parts, doc), category: defaultCategory(doc), source: doc.source, sourceName: doc.originalName, notes,
    parts: parts.map(part => ({ chars: part.content.length, content: part.content })) };
}

export async function collectDocument(documentId: string, input: z.infer<typeof collectInput>, actor: AuthUser) {
  admin(actor);
  const value = collectInput.parse(input);
  const { doc, docId, parsing, parts } = await collectionSource(documentId, actor);
  const title = value.title ?? suggestedTitle(parts, doc);
  const category = value.category ?? defaultCategory(doc);
  const source = value.source ?? doc.source ?? doc.originalName;
  const ids: string[] = [];
  for (let index = 0; index < parts.length; index++) {
    const importKey = `document-collection:${docId}:${parsing.id}:${index}`;
    const existing = await AgentKnowledge.findOne({ ...scope(actor), importKey });
    if (existing) { ids.push(existing.id); continue; }
    try {
      ids.push(await appendKnowledge(undefined, {
        accessScope: 'project', expectedVersion: 0,
        title: (parts.length === 1 ? title : `${title} · 第 ${index + 1} 部分`).slice(0, 160),
        tags: [], content: parts[index].content, source: source.slice(0, 500), approved: value.publish,
        category, applicability: value.applicability ?? COLLECTION_APPLICABILITY,
        products: value.products ?? [], validFrom: new Date(), terms: [],
      }, actor, importKey, partRefs(parts[index], parsing, { id: docId, sha256: doc.sha256 })));
    } catch (e) {
      if ((e as { code?: number }).code !== 11000) throw e;
      ids.push((await AgentKnowledge.findOne({ ...scope(actor), importKey }))!.id);
    }
  }
  return { ids, count: parts.length, category };
}

// Removing a file also removes the entries collected from it: they are derived
// views of the same text, and leaving them behind is what made "重新上传" messy.
export async function deleteDocument(documentId: string, actor: AuthUser) {
  admin(actor);
  const doc = await KnowledgeDocument.findOne({ _id: id(documentId), ...scope(actor) }).lean();
  if (!doc) throw ApiError.notFound('资料不存在或无权访问');
  const linked = await AgentKnowledge.find({ ...scope(actor), 'revisions.sourceRefs.documentId': String(doc._id) }).select('_id').lean();
  if (linked.length) await AgentKnowledge.deleteMany({ _id: { $in: linked.map(k => k._id) }, projectId: doc.projectId });
  await KnowledgeChunk.deleteMany({ projectId: doc.projectId, documentId: doc._id });
  await KnowledgeParsing.deleteMany({ projectId: doc.projectId, documentId: doc._id });
  if (doc.blobKey && !await KnowledgeDocument.exists({ projectId: doc.projectId, blobKey: doc.blobKey, _id: { $ne: doc._id } })) {
    await KnowledgeBlob.deleteOne({ _id: doc.blobKey, projectId: doc.projectId });
  }
  await KnowledgeDocument.deleteOne({ _id: doc._id, projectId: doc.projectId });
  if (linked.length) await knowledgeIndexChanged(actor).catch(() => undefined);
  return { removedKnowledge: linked.length, removedFile: true };
}

export async function legacyPreview(actor: AuthUser, before?: string) {  admin(actor);
  const rows = await AgentKnowledge.find({ ...scope(actor), ...(before ? { _id: { $lt: id(before) } } : {}) }).sort({ _id: -1 }).limit(30).lean();
  const mappings = await KnowledgeDocument.find({ ...scope(actor), kind: 'legacy_inline', legacyKnowledgeId: { $in: rows.map(r => r._id) } }).select('legacyKnowledgeId legacyVersion').lean();
  return { entries: rows.map(k => ({ id: String(k._id), version: k.version, approvedVersion: k.approvedVersion, archived: k.archived,
    revisions: k.revisions.map(v => ({ version: v.version, title: v.title, sha256: digest(v.content), bytes: Buffer.byteLength(v.content),
      mapped: mappings.some(m => String(m.legacyKnowledgeId) === String(k._id) && m.legacyVersion === v.version) })) })),
    next: rows.length === 30 ? String(rows.at(-1)!._id) : null, changesKnowledge: false };
}

export async function mapLegacy(knowledgeId: string, version: number, actor: AuthUser) {
  admin(actor);
  const knowledge = await AgentKnowledge.findOne({ _id: id(knowledgeId), ...scope(actor) });
  const v = knowledge?.revisions.find(r => r.version === version);
  if (!knowledge || !v) throw ApiError.notFound();
  const data = Buffer.from(v.content, 'utf8'), sha256 = digest(data);
  const blob = await KnowledgeBlob.findOneAndUpdate({ ...scope(actor), sha256 }, { $setOnInsert: { ...scope(actor), sha256, data } }, { upsert: true, new: true });
  const doc = await KnowledgeDocument.findOneAndUpdate({ ...scope(actor), kind: 'legacy_inline', legacyKnowledgeId: knowledge._id, legacyVersion: version }, { $setOnInsert: {
    ...scope(actor), kind: 'legacy_inline', legacyKnowledgeId: knowledge._id, legacyVersion: version, sha256, blobKey: blob!._id,
    originalName: v.title + ' v' + version + '.txt', extension: 'txt', mime: 'text/plain', bytes: data.length, uploadedBy: actor.id, source: v.source, category: v.category,
  } }, { new: true, upsert: true });
  const artifactHash = digest(JSON.stringify({ content: v.content, legacyId: knowledge.id, version }));
  const parsing = await KnowledgeParsing.findOneAndUpdate({ documentId: doc!._id, revision: 1 }, { $setOnInsert: {
    ...scope(actor), documentId: doc!._id, requestedBy: actor.id, revision: 1, parserVersion: 'legacy-inline-v1', configHash: 'legacy-v1',
    state: 'partial', stage: '历史正文快照', artifactHash, chunkCount: 1, warnings: ['仅保留历史正文与文本区间；未获得原文件页码，未改写或发布现有知识。'],
  } }, { new: true, upsert: true });
  const key = digest(doc!.id + ':' + parsing!.id + ':' + artifactHash);
  await KnowledgeChunk.updateOne({ _id: key }, { $setOnInsert: { ...scope(actor), documentId: doc!._id, parsingRevisionId: parsing!._id, artifactHash,
    ordinal: 0, content: v.content, contentHash: sha256, headingPath: [v.title], language: 'und', indexEligible: false, reviewRequired: true,
    location: { kind: 'text', offsetUnit: 'unicode_codepoints', start: 0, end: Array.from(v.content).length, legacyKnowledgeId: knowledge.id, legacyVersion: version },
  } }, { upsert: true });
  return { id: doc!.id, changesKnowledge: false };
}

// Durable lease + fenced artifact pointer: stale/crashed workers cannot activate
// chunks. Results are committed before the success state; retry is a new revision.
export async function processKnowledgeDocument(parsingId?: string): Promise<void> {
  const now = new Date(), token = randomUUID();
  const parsing = await KnowledgeParsing.findOneAndUpdate({ ...(parsingId ? { _id: id(parsingId) } : {}),
    $or: [{ state: 'queued' }, { state: 'running', leaseUntil: { $lt: now } }] },
    { $set: { state: 'running', leaseToken: token, leaseUntil: new Date(Date.now() + 30000), stage: '启动本地解析' }, $inc: { attempts: 1 } }, { new: true, sort: { createdAt: 1 } });
  if (!parsing) return;
  const fence = { _id: parsing._id, leaseToken: token, state: 'running' };
  const abort = new AbortController();
  let checking = false;
  const heartbeat = setInterval(() => {
    if (checking) return; checking = true;
    void currentActor(parsing.projectId, parsing.requestedBy).then(async () => {
      if (!(await KnowledgeParsing.updateOne(fence, { $set: { leaseUntil: new Date(Date.now() + 30000) } })).matchedCount) abort.abort();
    }).catch(() => abort.abort()).finally(() => { checking = false; });
  }, 2000);
  try {
    if (parsing.attempts > 3) throw new ParserError('recovery_limit', '多次中断未能恢复，请检查环境后手动重试');
    await currentActor(parsing.projectId, parsing.requestedBy);
    const identity = await parserIdentity();
    if (parsing.configHash !== digest(JSON.stringify({ configHash, ...identity }))) throw new ParserError('parser_changed', '解析组件已更新，请重新解析以保留版本记录');
    const doc = await KnowledgeDocument.findOne({ _id: parsing.documentId, projectId: parsing.projectId });
    const blob = doc && await KnowledgeBlob.findOne({ _id: doc.blobKey, projectId: parsing.projectId, sha256: doc.sha256 }).select('+data');
    if (!doc || !blob?.data) throw new ParserError('missing_original', '原文缺失，请恢复备份后重试');
    const result = await runParser(Buffer.from(blob.data), doc.extension, doc.sha256, abort.signal, async p => {
      if (!(await KnowledgeParsing.updateOne(fence, { $set: p })).matchedCount) abort.abort();
    });
    await currentActor(parsing.projectId, parsing.requestedBy);
    if (abort.signal.aborted || !await KnowledgeParsing.exists(fence)) throw new ParserError('cancelled', '任务已停止');
    const artifactHash = digest(JSON.stringify(result));
    await KnowledgeChunk.bulkWrite(result.chunks.map(c => ({ updateOne: { filter: { _id: digest(doc.id + ':' + parsing.id + ':' + artifactHash + ':' + c.ordinal + ':' + c.contentHash) },
      update: { $setOnInsert: { ...c, projectId: parsing.projectId, documentId: doc._id, parsingRevisionId: parsing._id, artifactHash } }, upsert: true } })));
    // No artifact body on job: chunks are bounded separate documents, not a 16MB Mongo document.
    const { chunks, ...artifact } = result;
    await KnowledgeParsing.updateOne(fence, { $set: { state: result.state, stage: '等待审核', done: chunks.length, total: chunks.length,
      artifactHash, artifact, chunkCount: chunks.length, warnings: result.warnings }, $unset: { leaseToken: 1, leaseUntil: 1, error: 1 } });
  } catch (e) {
    const error = e instanceof ParserError ? { code: e.code, message: e.message } : { code: 'processing_failed', message: '资料处理失败，请检查本地解析环境与存储后重试' };
    await KnowledgeParsing.updateOne(fence, { $set: { state: error.code==='runtime_stopped'?'queued':'failed', stage: error.code==='runtime_stopped'?'等待服务重启':'解析未完成', error }, $unset: { leaseToken: 1, leaseUntil: 1 } });
  } finally { clearInterval(heartbeat); abort.abort(); }
}

export async function recoverUnqueuedDocuments() {
  const pending = await KnowledgeDocument.aggregate([
    {$match:{kind:'project_document'}},
    {$lookup:{from:KnowledgeParsing.collection.name,localField:'_id',foreignField:'documentId',as:'jobs',pipeline:[{$limit:1}]}},
    {$match:{jobs:{$size:0}}},{$limit:10},
  ]);
  for (const d of pending) {
    const doc = await KnowledgeDocument.findById(d._id); if (!doc) continue;
    try { await enqueue(doc,await currentActor(doc.projectId,doc.uploadedBy),1); }
    catch (e) {
      if (!(e instanceof ParserError)) throw e;
      await KnowledgeParsing.updateOne({documentId:doc._id,revision:1},{$setOnInsert:{projectId:doc.projectId,documentId:doc._id,requestedBy:doc.uploadedBy,
        revision:1,parserVersion:PARSER_VERSION,configHash,state:'failed',stage:'任务权限已失效',error:{code:e.code,message:e.message}}},{upsert:true});
    }
  }
}

let timer: NodeJS.Timeout | undefined, busy = false;
export function startKnowledgeDocumentWorker() {
  if (timer || process.env.NODE_ENV === 'test' || process.env.NODE_TEST_CONTEXT) return;
  timer = setInterval(() => {
    if (busy || mongoose.connection.readyState !== 1) return;
    busy = true;
    void recoverUnqueuedDocuments().then(()=>processKnowledgeDocument()).catch(() => undefined).finally(() => { busy = false; });
  }, 2000); timer.unref();
}

export function stopKnowledgeDocumentWorker(){if(timer)clearInterval(timer);timer=undefined;stopParserProcesses();}
