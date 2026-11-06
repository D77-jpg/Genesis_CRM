import type { Migration } from './types';
import { IntegrationWebhook, IntegrationWebhookEvent, IntegrationWebhookAttempt } from '../models/IntegrationWebhook';
export const globalSiteWebhookMigration: Migration = { id: '20261106-010-globalsite-webhooks', version: 1, name: 'Create project webhook outbox and delivery indexes', async up(connection) { for (const m of [IntegrationWebhook, IntegrationWebhookEvent, IntegrationWebhookAttempt])
        await m.createIndexes(); await connection.collection('quotations').createIndex({ organizationId: 1, projectId: 1, globalSiteSentAt: 1, _id: 1 }); await connection.collection('customerevents').createIndex({ organizationId: 1, projectId: 1, type: 1, _id: 1 }); } };
