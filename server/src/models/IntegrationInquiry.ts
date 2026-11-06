import './tenant-setup';
import { Schema, model } from 'mongoose';
const inquiry = new Schema<any>({
    projectId: { type: Schema.Types.ObjectId, required: true, index: true }, customerId: { type: Schema.Types.ObjectId, required: true, index: true },
    sourceSystem: { type: String, enum: ['globalsite'], default: 'globalsite' }, externalInquiryId: { type: String, required: true, maxlength: 128 },
    requestHash: { type: String, required: true }, secret: { type: Schema.Types.Mixed, required: true, select: false }, submittedAt: Date,
    siteName: String, notifyUserIds: [Schema.Types.ObjectId], readBy: [Schema.Types.ObjectId], response: Schema.Types.Mixed,
}, { timestamps: true });
inquiry.index({ organizationId: 1, projectId: 1, sourceSystem: 1, externalInquiryId: 1 }, { unique: true });
inquiry.index({ organizationId: 1, projectId: 1, customerId: 1, _id: -1 });
inquiry.index({ organizationId: 1, projectId: 1, notifyUserIds: 1, _id: -1 });
export const IntegrationInquiry = model<any>('IntegrationInquiry', inquiry);
const job = new Schema<any>({
    projectId: { type: Schema.Types.ObjectId, required: true }, inquiryId: { type: Schema.Types.ObjectId, required: true },
    attachmentId: { type: String, required: true }, status: { type: String, enum: ['pending', 'running', 'stored', 'failed'], default: 'pending' },
    attempts: { type: Number, default: 0 }, nextAttemptAt: { type: Date, default: Date.now }, owner: String, fence: { type: Number, default: 0 }, leaseUntil: Date,
    key: String, mime: String, bytes: Number, errorCode: String
}, { timestamps: true });
job.index({ organizationId: 1, projectId: 1, inquiryId: 1, attachmentId: 1 }, { unique: true });
job.index({ status: 1, nextAttemptAt: 1, leaseUntil: 1 });
export const IntegrationInquiryAttachment = model<any>('IntegrationInquiryAttachment', job);
const lock = new Schema<any>({ projectId: { type: Schema.Types.ObjectId, required: true }, version: { type: Number, default: 0 } }, { timestamps: true });
lock.index({ organizationId: 1, projectId: 1 }, { unique: true });
export const IntegrationInquiryLock = model<any>('IntegrationInquiryLock', lock);
