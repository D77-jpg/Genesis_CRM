// Disposable memory database; never reads MONGODB_URI and never starts mail workers.
import { MongoMemoryServer } from 'mongodb-memory-server';
import { writeFile } from 'node:fs/promises';
process.env.NODE_ENV = 'test'; process.env.AI_PROVIDER = 'mock'; process.env.MAIL_CHANNEL = 'mock';
async function main() {
  const memory = await MongoMemoryServer.create({ instance: { dbName: 's1_ui_fictional_only' } });
  const mongoose = await import('mongoose'); await mongoose.connect(memory.getUri());
  const { User, Project, hashPassword } = await import('../src/models');
  const project = await Project.create({ name: 'S1 虚构资料验收', slug: 's1-ui-fixture', code: 'S1DEMO', companyName: 'FICTIONAL ONLY', mailProfileKey: 's1-fixture', isDefault: true });
  const password = ['S1', 'fictional', 'only'].join('-');
  await User.create({ username: 's1-demo', displayName: '资料审核员（测试）', passwordHash: await hashPassword(password), role: 'admin', projectIds: [project._id], defaultProjectId: project._id });
  const { createApp } = await import('../src/app');
  const { processKnowledgeDocument, recoverUnqueuedDocuments } = await import('../src/services/knowledge/document.service');
  const server = createApp().listen(5002, '127.0.0.1');
  let busy = false;
  const tick = setInterval(() => { if (busy) return; busy = true; void recoverUnqueuedDocuments().then(() => processKnowledgeDocument()).finally(() => { busy = false; }); }, 1000);
  const output = process.env.S1_UI_RECEIPT;
  if (output) await writeFile(output, JSON.stringify({ pid: process.pid, projectId: String(project._id), port: 5002, fictional: true }));
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => {
    clearInterval(tick); server.close(() => { void mongoose.disconnect().then(() => memory.stop()).then(() => process.exit(0)); });
  });
  console.log('S1 fictional UI fixture ready on 5002. No email workers.');
}
void main().catch(e => { console.error('Fixture failed:', e.name); process.exit(1); });
