import mongoose from 'mongoose';
import { tenantPlugin } from './tenant.plugin';

const marker = '__genesisTenantPluginRegistered';
const globalMongoose = mongoose as typeof mongoose & { [marker]?: boolean };
if (!globalMongoose[marker]) {
  mongoose.plugin(tenantPlugin);
  globalMongoose[marker] = true;
}
