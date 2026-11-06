import type { Migration } from './types';
import { IntegrationInquiry, IntegrationInquiryAttachment, IntegrationInquiryLock } from '../models/IntegrationInquiry';
export const globalSiteInquiryMigration: Migration = { id: '20261106-009-globalsite-inquiries', version: 1, name: 'Create isolated GlobalSite inquiry and attachment indexes',
    async up(connection) { for (const m of [IntegrationInquiry, IntegrationInquiryAttachment, IntegrationInquiryLock])
        await m.createIndexes(); await connection.collection('customers').createIndex({ organizationId: 1, projectId: 1, globalSiteSource: 1 }); } };
