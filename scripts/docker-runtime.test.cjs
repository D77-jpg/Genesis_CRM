'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

test('docker contexts exclude runtime secrets, PII and dependency trees', () => {
  for (const context of ['server', 'web']) {
    const ignore = read(`${context}/.dockerignore`);
    for (const required of ['.env', '**/node_modules', '**/dist', '*.pem']) {
      assert.ok(ignore.split(/\r?\n/).includes(required), `${context}: ${required}`);
    }
    assert.match(read(`${context}/Dockerfile`), /USER (node|nginx)/);
    assert.match(read(`${context}/Dockerfile`), /HEALTHCHECK/);
  }
  assert.match(read('server/.dockerignore'), /^uploads$/m);
  assert.match(read('.gitignore'), /^\.env\.production$/m);
});

test('standalone ingress and healthcheck contract', () => {
  const compose = read('compose.yaml');
  assert.match(compose, /127\.0\.0\.1:\$\{GENESIS_HTTP_PORT:-8080\}:8080/);
  assert.equal((compose.match(/^    ports:/gm) || []).length, 1);
  assert.match(compose, /mongo_data:\/data\/db/);
  assert.match(compose, /uploads:\/data\/uploads/);
  assert.match(compose, /backups:\/backups/);
  assert.match(compose, /service_healthy/g);
  assert.match(read('server/Dockerfile'), /\/api\/health/);
  assert.match(read('web/nginx.conf'), /proxy_pass http:\/\/server:5000;/);
  assert.match(read('web/Dockerfile'), /ARG VITE_API_BASE_URL=\/api/);
});

test('example contains no production credentials', () => {
  const example = read('.env.production.example');
  for (const key of ['JWT_SECRET', 'ADMIN_PASSWORD', 'MAIL_CREDENTIAL_ENCRYPTION_KEY', 'MONGO_ROOT_PASSWORD']) {
    assert.match(example, new RegExp(`^${key}=REPLACE_WITH_`, 'm'));
  }
});
