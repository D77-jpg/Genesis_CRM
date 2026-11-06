import { globalSiteOAuthMigration } from './011-globalsite-oauth';
import {globalSiteWebhookMigration} from './010-globalsite-webhooks';
import {globalSiteInquiryMigration} from './009-globalsite-inquiries';
import { defaultOrganizationMigration } from './001-default-organization';
import { bootstrapProjectsMigration } from './002-bootstrap-projects';
import { bootstrapAdminMigration } from './003-bootstrap-admin';
import { legacyCustomerStatusMigration } from './004-customer-status';
import { mailCustomerLastContactMigration } from './005-mail-last-contact';
import { legacyQuotationVersionMigration } from './006-quotation-version';
import { indexSynchronizationMigration } from './007-sync-indexes';
import { backfillLetterOrganizationMigration } from './008-backfill-letter-organization';
import type { Migration } from './types';

/** Ordered registry. Append only; ids sort lexicographically by date. */
export const migrations: Migration[] = [
  defaultOrganizationMigration,
  bootstrapProjectsMigration,
  bootstrapAdminMigration,
  legacyCustomerStatusMigration,
  mailCustomerLastContactMigration,
  legacyQuotationVersionMigration,
  indexSynchronizationMigration,
  backfillLetterOrganizationMigration,
  globalSiteInquiryMigration,
  globalSiteWebhookMigration,
  globalSiteOAuthMigration,
];
