import type { Migration } from './types';
import { oauthModels } from '../models/OAuth';
export const globalSiteOAuthMigration: Migration = {
    id: '20261106-011-globalsite-oauth', version: 1, name: 'Create tenant-scoped OIDC identity indexes',
    async up() { for (const model of oauthModels)
        await model.createIndexes(); }
};
