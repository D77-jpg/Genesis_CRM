import './tenant-setup';
import { Schema, model } from 'mongoose';
const config = new Schema<any>({
    projectId: { type: Schema.Types.ObjectId, required: true }, targetUrl: { type: String, required: true }, events: [String], enabled: { type: Boolean, default: false }, revision: { type: Number, default: 1 }, generation: { type: Number, default: 1 }, keyId: { type: Schema.Types.ObjectId, required: true }, secret: { type: Schema.Types.Mixed, required: true, select: false }, activeSince: { type: Date, required: true },
    lastTickAt: { type: Date, default: () => new Date(0) }, ioOwner: String, ioUntil: Date, ioFence: { type: Number, default: 0 }, statusScan: Schema.Types.Mixed, quotationScan: Schema.Types.Mixed
}, { timestamps: true });
config.index({ organizationId: 1, projectId: 1 }, { unique: true });
config.index({ enabled: 1, ioUntil: 1 });
export const IntegrationWebhook = model<any>('IntegrationWebhook', config);
const event = new Schema<any>({
    projectId: { type: Schema.Types.ObjectId, required: true }, configId: { type: Schema.Types.ObjectId, required: true }, generation: { type: Number, required: true }, sourceKey: { type: String, required: true }, type: { type: String, required: true }, occurredAt: { type: Date, required: true }, secret: { type: Schema.Types.Mixed, required: true, select: false },
    status: { type: String, enum: ['pending', 'running', 'delivered', 'failed', 'cancelled'], default: 'pending' }, attempts: { type: Number, default: 0 }, retryBase: { type: Number, default: 0 }, nextAttemptAt: { type: Date, default: Date.now }, lastStatusCode: { type: Number, default: null }, lastErrorCode: { type: String, default: null }
}, { timestamps: true });
event.index({ organizationId: 1, projectId: 1, configId: 1, generation: 1, sourceKey: 1 }, { unique: true });
event.index({ organizationId: 1, projectId: 1, configId: 1, generation: 1, status: 1, nextAttemptAt: 1 });
export const IntegrationWebhookEvent = model<any>('IntegrationWebhookEvent', event);
const attempt = new Schema<any>({
    projectId: { type: Schema.Types.ObjectId, required: true }, deliveryId: { type: Schema.Types.ObjectId, required: true }, attempt: { type: Number, required: true }, status: { type: String, enum: ['started', 'delivered', 'failed', 'unknown'], required: true }, startedAt: { type: Date, required: true }, finishedAt: { type: Date, default: null }, statusCode: { type: Number, default: null }, errorCode: { type: String, default: null }, durationMs: { type: Number, default: null }
}, { timestamps: true });
attempt.index({ organizationId: 1, projectId: 1, deliveryId: 1, attempt: 1 }, { unique: true });
export const IntegrationWebhookAttempt = model<any>('IntegrationWebhookAttempt', attempt);
