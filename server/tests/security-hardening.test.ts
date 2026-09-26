import assert from 'node:assert/strict';
import test from 'node:test';
import { Types } from 'mongoose';

process.env.JWT_SECRET ||= 'fixture-jwt-value-ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890';
process.env.ADMIN_PASSWORD ||= 'fixture-password';

const { validateProductionSecrets } = require('../src/config/env');
const { createAttachmentSchema } = require('../src/validators/attachment.validator');
const { attachmentAllowed, mailError } = require('../src/services/mail-security');

const randomJwt = 'A9!b2C3$d4E5%f6G7&h8I9*j0K1(l2M3)n4O5';
const randomKey = 'Z8!y7X6$w5V4%u3T2&s1R0*q9P8(o7N6)m5L4';
const randomPassword = 'A1!b2C3$d4E5%f6G';

test('production rejects missing, default, shared, and weak secrets; test env stays compatible', () => {
  const safe = { NODE_ENV: 'production', JWT_SECRET: randomJwt, ADMIN_PASSWORD: randomPassword, MAIL_CREDENTIAL_ENCRYPTION_KEY: randomKey };
  assert.deepEqual(validateProductionSecrets(safe), []);
  assert.ok(validateProductionSecrets({ ...safe, JWT_SECRET: 'a'.repeat(32) }).length);
  assert.ok(validateProductionSecrets({ ...safe, ADMIN_PASSWORD: 'admin123' }).length);
  assert.ok(validateProductionSecrets({ ...safe, MAIL_CREDENTIAL_ENCRYPTION_KEY: undefined }).length);
  assert.ok(validateProductionSecrets({ ...safe, MAIL_CREDENTIAL_ENCRYPTION_KEY: randomJwt }).length);
  assert.deepEqual(validateProductionSecrets({ ...safe, NODE_ENV: 'test', MAIL_CREDENTIAL_ENCRYPTION_KEY: undefined }), []);
});

test('attachment filename rejects traversal and header injection', () => {
  for (const name of ['../secret.pdf', '..\\secret.pdf', 'safe\r\nX-Foo: bar.pdf', '.', 'trailing.']) {
    assert.equal(createAttachmentSchema.safeParse({ originalName: name, dataBase64: 'AA==' }).success, false, name);
  }
  assert.equal(createAttachmentSchema.safeParse({ originalName: '采购单.pdf', dataBase64: 'AA==' }).success, true);
});

test('file signatures must match declared type and extension; oversized and traversal rejected', () => {
  const pdf = Buffer.from('%PDF-1.7\nfixture');
  assert.equal(attachmentAllowed('quote.pdf', 'application/pdf', pdf, 1024), true);
  assert.equal(attachmentAllowed('quote.pdf', 'image/png', pdf, 1024), false);
  assert.equal(attachmentAllowed('../quote.pdf', 'application/pdf', pdf, 1024), false);
  assert.equal(attachmentAllowed('quote.pdf', 'application/pdf', pdf, pdf.length - 1), false);
  assert.equal(attachmentAllowed('script.html', 'text/html', Buffer.from('<script/>'), 1024), false);
});

test('attachment download rejects cross-project records before filesystem reads', async () => {
  const { CustomerAttachment } = require('../src/models');
  const { getAttachmentForDownload } = require('../src/services/attachment.service');
  const customerId = new Types.ObjectId();
  const attachmentId = new Types.ObjectId();
  const projectId = new Types.ObjectId();
  const original = CustomerAttachment.findOne;
  CustomerAttachment.findOne = (filter: { _id: Types.ObjectId; customerId: Types.ObjectId; projectId: Types.ObjectId }) => {
    assert.equal(String(filter._id), String(attachmentId));
    assert.equal(String(filter.customerId), String(customerId));
    assert.equal(String(filter.projectId), String(projectId));
    return Promise.resolve(null);
  };
  try {
    await assert.rejects(getAttachmentForDownload(String(customerId), String(attachmentId), String(projectId)),
      (error: { statusCode: number }) => error.statusCode === 404);
    await assert.rejects(getAttachmentForDownload(String(customerId), String(attachmentId), ''),
      (error: { statusCode: number }) => error.statusCode === 404);
  } finally {
    CustomerAttachment.findOne = original;
  }
});

test('mail transport failures never echo credential-bearing exception text', () => {
  for (const protocol of ['SMTP', 'IMAP'] as const) {
    assert.doesNotMatch(mailError(new Error('credential-canary-987654'), protocol), /credential-canary/);
  }
});
