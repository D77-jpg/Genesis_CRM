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
import { KNOWLEDGE_CATEGORIES } from '../agent/knowledge-types';
import { configHash, parserConfig, parserIdentity, PARSER_VERSION, ParserError, runParser } from './parser-process';

const formats: Record<string, string> = { txt: 'text/plain', md: 'text/markdown', markdown: 'text/markdown', pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', csv: 'text/csv', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg' };
export const uploadInput = z.object({ fileName: z.string().min(1).max(180), data: z.string().min(4).max(20971520),
  source: z.string().trim().min(1).max(350), category: z.enum(KNOWLEDGE_CATEGORIES) }).strict();
export const reviewInput = z.object({ title: z.string().trim().min(1).max(160), content: z.string().trim().min(1).max(12000),
  category: z.enum(KNOWLEDGE_CATEGORIES), applicability: z.string().trim().min(1).max(1000) }).strict();
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
    mime: formats[extension], bytes: data.length, sha256, blobKey: blob!._id, uploadedBy: actor.id, source: value.source, category: value.category }); }
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
    result.push({products,reviewState,validity, ...d, id: String(d._id), blobKey: undefined, parsing: parsing ? { ...parsing, id: String(parsing._id), artifact: undefined, leaseToken: undefined } : null });
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
  admin(actor); const reviewed = reviewInput.parse(input);
  if (!/^[a-f0-9]{64}$/.test(chunkId)) throw ApiError.notFound();
  const chunk = await KnowledgeChunk.findOne({ _id: chunkId, ...scope(actor) });
  if (!chunk) throw ApiError.notFound();
  const parsing = await KnowledgeParsing.findOne({ _id: chunk.parsingRevisionId, ...scope(actor), state: { $in: ['succeeded', 'partial'] }, artifactHash: chunk.artifactHash });
  const doc = await KnowledgeDocument.findOne({ _id: chunk.documentId, ...scope(actor) });
  if (!parsing || !doc) throw ApiError.conflict('解析结果尚未就绪');
  const importKey = 'document-chunk:' + chunkId;
  const existing = await AgentKnowledge.findOne({ ...scope(actor), importKey });
  if (existing) return { id: existing.id, duplicate: true };
  try {
    const knowledgeId = await appendKnowledge(undefined, { ...reviewed, source: `${doc.source} · ${doc.originalName}`.slice(0, 500),
      expectedVersion: 0, approved: false, tags: [], products: [], terms: [] }, actor, importKey,
    [{ documentId: doc.id, parsingRevisionId: parsing.id, chunkId, contentHash: chunk.contentHash, location: chunk.location,
      parserVersion: parsing.parserVersion, artifactHash: parsing.artifactHash, originalSha256: doc.sha256 }]);
    return { id: knowledgeId, duplicate: false };
  } catch (e) {
    if ((e as { code?: number }).code !== 11000) throw e;
    return { id: (await AgentKnowledge.findOne({ ...scope(actor), importKey }))!.id, duplicate: true };
  }
}

export async function legacyPreview(actor: AuthUser, before?: string) {
  admin(actor);
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
    await KnowledgeParsing.updateOne(fence, { $set: { state: 'failed', stage: '解析未完成', error }, $unset: { leaseToken: 1, leaseUntil: 1 } });
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
