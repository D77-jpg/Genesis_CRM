import { Schema, model } from 'mongoose';

// Raw data is private, immutable, and distinct from knowledge publication.
export const KnowledgeBlob = model('KnowledgeBlob', new Schema({
  projectId: { type: Schema.Types.ObjectId, required: true }, sha256: { type: String, required: true },
  data: { type: Buffer, required: true, select: false },
}, { timestamps: true, versionKey: false }).index({ projectId: 1, sha256: 1 }, { unique: true }));

export const KnowledgeDocument = model('KnowledgeDocument', new Schema({
  projectId: { type: Schema.Types.ObjectId, required: true },
  kind: { type: String, enum: ['project_document', 'legacy_inline'], required: true },
  originalName: { type: String, required: true }, extension: { type: String, required: true },
  mime: String, bytes: Number, sha256: { type: String, required: true }, blobKey: Schema.Types.ObjectId,
  uploadedBy: { type: Schema.Types.ObjectId, required: true }, visibility: { type: String, default: 'project_admin' },
  source: { type: String, required: true }, category: String,
  legacyKnowledgeId: Schema.Types.ObjectId, legacyVersion: Number,
}, { timestamps: true, versionKey: false }).index({ projectId: 1, sha256: 1, kind: 1, legacyKnowledgeId: 1, legacyVersion: 1 }, { unique: true }));

export const KnowledgeParsing = model('KnowledgeParsing', new Schema({
  projectId: { type: Schema.Types.ObjectId, required: true }, documentId: { type: Schema.Types.ObjectId, required: true },
  requestedBy: { type: Schema.Types.ObjectId, required: true }, revision: { type: Number, required: true },
  parserVersion: { type: String, required: true }, configHash: { type: String, required: true },
  state: { type: String, enum: ['queued', 'running', 'succeeded', 'partial', 'failed', 'cancelled'], required: true },
  attempts: { type: Number, default: 0 }, leaseToken: String, leaseUntil: Date,
  stage: String, done: { type: Number, default: 0 }, total: { type: Number, default: 1 },
  error: { code: String, message: String }, warnings: { type: [String], default: [] },
  artifactHash: String, artifact: Schema.Types.Mixed, chunkCount: Number,
}, { timestamps: true, versionKey: false })
  .index({ documentId: 1, revision: 1 }, { unique: true })
  .index({ state: 1, leaseUntil: 1, createdAt: 1 }));

export const KnowledgeChunk = model('KnowledgeChunk', new Schema({
  _id: String, projectId: { type: Schema.Types.ObjectId, required: true }, documentId: { type: Schema.Types.ObjectId, required: true },
  parsingRevisionId: { type: Schema.Types.ObjectId, required: true }, artifactHash: { type: String, required: true },
  ordinal: Number, content: String, contentHash: String, tokenCount: Number, indexEligible: Boolean,
  headingPath: [String], language: String, location: Schema.Types.Mixed, table: Schema.Types.Mixed, headers: [String], footnotes: [String],
  currencies: [String], units: [String], warnings: [String], reviewRequired: Boolean,
}, { timestamps: true, versionKey: false }).index({ projectId: 1, parsingRevisionId: 1, artifactHash: 1, ordinal: 1 }));
