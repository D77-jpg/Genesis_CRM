import { Schema, model } from 'mongoose';

// Only inbound mail is stored here. Outbound mail keeps the V1 DevelopmentLetter model.
const schema = new Schema({
  projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true, index: true },
  mailAccountId: { type: Schema.Types.ObjectId, ref: 'UserMailAccount', index: true },
  mailboxUserId: { type: Schema.Types.ObjectId, ref: 'User', index: true },
  mailboxAddress: { type: String, trim: true, lowercase: true, maxlength: 200 },
  dedupKey: { type: String, required: true },
  deleted: { type: Boolean, default: false },
  customerId: { type: Schema.Types.ObjectId, ref: 'Customer', index: true, default: null },
  threadId: { type: String, required: true, index: true },
  messageId: { type: String, index: true },
  inReplyTo: String,
  references: { type: [String], default: [] },
  subject: { type: String, default: '' },
  normalizedSubject: { type: String, index: true },
  from: { type: String, required: true },
  fromName: String,
  to: { type: [String], default: [] },
  cc: { type: [String], default: [] },
  html: { type: String, default: '' },
  text: { type: String, default: '' },
  sentAt: { type: Date, required: true },
  readBy: { type: [String], default: [] },
  attachments: [{
    name: String, mimeType: String, size: Number,
    filename: { type: String, select: false }, blocked: String,
  }],
}, { timestamps: true, versionKey: false });
schema.index({ projectId: 1, dedupKey: 1 }, { unique: true });
schema.index({ projectId: 1, customerId: 1, sentAt: -1 });
schema.index({ projectId: 1, mailboxUserId: 1, sentAt: -1 });
schema.index({ projectId: 1, threadId: 1, sentAt: 1 });
export const MailMessage = model('MailMessage', schema);

// Durable mailbox cursor and renewable lease; never stores authentication data.
export const MailSyncState = model('MailSyncState', new Schema({
  _id: String,
  projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true, index: true },
  uidValidity: String,
  lastUid: { type: Number, default: 0 },
  failedUids: { type: [Number], default: [] },
  leaseOwner: String,
  leaseUntil: Date,
  lastSyncAt: Date,
  lastError: String,
  skipped: { type: Number, default: 0 },
}, { versionKey: false }));
