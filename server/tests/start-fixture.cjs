// Isolated development/test host. Never reads the user's mailbox credentials.
const { MongoMemoryServer } = require('mongodb-memory-server');
const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');

(async () => {
  const mongo = await MongoMemoryServer.create({ instance: { dbName: 'v21_regression' } });
  const fixturePort = process.env.FIXTURE_PORT || '5000';
  const env = { ...process.env, NODE_ENV: 'test', PORT: fixturePort, MONGODB_URI: mongo.getUri(),
    JWT_SECRET: crypto.randomBytes(32).toString('hex'), ADMIN_USERNAME: 'admin', ADMIN_PASSWORD: 'password',
    MAIL_TRANSPORT: 'mock', IMAP_ENABLED: 'false', UPLOAD_DIR: path.resolve(__dirname, '../tmp/test-uploads') };
  fs.mkdirSync(path.resolve(__dirname, '../tmp'), { recursive: true });
  // Only database URI (random isolated localhost port), no JWT or mail credentials.
  fs.writeFileSync(path.resolve(__dirname, '../tmp/test-db.json'), JSON.stringify({ uri: mongo.getUri() }));
  const seed = spawn(process.execPath, ['--require', './tests/os-user-info.cjs', '--import', 'tsx', 'src/scripts/seed.ts'], { cwd: path.resolve(__dirname, '..'), env, stdio: 'inherit', windowsHide: true });
  const seedCode = await new Promise(r => seed.on('exit', r));
  if (seedCode !== 0) { await mongo.stop(); process.exit(1); }
  const server = spawn(process.execPath, ['--require', './tests/os-user-info.cjs', '--import', 'tsx', 'src/index.ts'], { cwd: path.resolve(__dirname, '..'), env, stdio: 'inherit', windowsHide: true });
  console.log(`Isolated V2.6 fixture: http://localhost:${fixturePort}`);
  const stop = async () => { server.kill(); await mongo.stop(); process.exit(); };
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
  server.on('exit', async code => { await mongo.stop(); process.exit(code || 0); });
})().catch(e => { console.error(e); process.exit(1); });
