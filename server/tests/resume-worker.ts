import mongoose from 'mongoose';
import { processMailJob } from '../src/services/mail-queue.service';

async function main() {
  if (!process.env.TEST_DB_NAME?.startsWith('v21_mail_tests_')) throw new Error('Only isolated test databases are allowed');
  await mongoose.connect(process.env.MONGODB_URI!, { dbName: process.env.TEST_DB_NAME });
  try { await processMailJob(process.argv[2]); }
  finally { await mongoose.disconnect(); }
}
void main().catch(() => { process.exitCode = 1; });
