import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { Types } from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import type { AuthUser } from '../src/types/express';

let mongo: MongoMemoryServer;
let mongoose: typeof import('mongoose');
let models: typeof import('../src/models');
let MailMessage: typeof import('../src/models/MailMessage')['MailMessage'];
let performance: typeof import('../src/services/template-performance.service');
let suggestions: typeof import('../src/services/template-suggestion.service');
let letters: typeof import('../src/services/letter.service');
const project = new Types.ObjectId();
const privateProject = new Types.ObjectId();
const owner = new Types.ObjectId();
const other = new Types.ObjectId();
const actor: AuthUser = { id: owner.toString(), username: 'template-owner', displayName: 'Owner', role: 'admin', projectId: project.toString() };
const cross: AuthUser = { ...actor, role: 'user', projectId: privateProject.toString() };
const another: AuthUser = { ...actor, id: other.toString(), username: 'other-owner' };
function hash(subject: string, content: string) { return createHash('sha256').update(JSON.stringify([subject, content])).digest('hex'); }
function deny(code: number) { return (error: unknown) => Boolean(error && typeof error === 'object' && 'statusCode' in error && (error as { statusCode: number }).statusCode === code); }

before(async () => {
  process.env.NODE_ENV = 'test'; process.env.MAIL_TRANSPORT = 'mock'; process.env.IMAP_ENABLED = 'false';
  mongo = await MongoMemoryServer.create();
  mongoose = await import('mongoose');
  await mongoose.default.connect(mongo.getUri(), { dbName: 'h05-template-feedback' });
  models = await import('../src/models');
  await models.User.create({ _id: owner, username: 'h05-owner', displayName: 'Owner', passwordHash: 'fixture', role: 'admin', projectIds: [project] });
  await models.Project.create({ _id: project, name: 'H05 Workspace', slug: 'h05-workspace', code: 'H05', companyName: 'H05', mailProfileKey: 'h05' });
  await models.Project.create({ _id: privateProject, name: 'H05 Private', slug: 'h05-private', code: 'H05P', companyName: 'H05 Private', mailProfileKey: 'h05-private' });
  MailMessage = (await import('../src/models/MailMessage')).MailMessage;
  performance = await import('../src/services/template-performance.service');
  suggestions = await import('../src/services/template-suggestion.service');
  letters = await import('../src/services/letter.service');
  const { LetterTemplate } = await import('../src/models/LetterTemplate');
  const { TemplateSuggestion } = await import('../src/models/TemplateSuggestion');
  await Promise.all([LetterTemplate.init(), TemplateSuggestion.init(), models.DevelopmentLetter.init(), models.Customer.init(), models.CustomerEvent.init(), MailMessage.init()]);
});
after(async () => { await mongoose.default.disconnect(); await mongo.stop(); });

test('H-05 letter attribution snapshots are project-verified, immutable on retries, and never inferred from matching text', async () => {
  const template = await models.LetterTemplate.create({ projectId: project, name: 'Product intro', subject: 'Hello {{name}}', content: '<p>Hi {{name}}</p>', category: 'first_contact' });
  const customer = await models.Customer.create({ projectId: project, ownerId: owner, name: 'Buyer', email: 'buyer.h05@fixture.test', source: 'manual' });
  const body = { customerId: customer.id, subject: template.subject, content: template.content,
    templateId: template.id, requestKey: `h05-draft-${new Types.ObjectId()}`, saveAsDraft: true, markAsDeveloped: false };
  const draft = await letters.sendLetter(body, actor);
  assert.equal(draft.letter.status, 'draft');
  assert.equal(draft.letter.templateId, template.id);
  assert.equal(draft.letter.templateNameSnapshot, 'Product intro');
  assert.equal(draft.letter.templateContentHash, hash(template.subject, template.content));
  assert.equal((await letters.sendLetter(body, actor)).letter.id, draft.letter.id);
  await assert.rejects(() => letters.sendLetter({ ...body, templateId: undefined }, actor), deny(409));
  await assert.rejects(() => letters.sendLetter({ ...body, subject: 'Changed' }, actor), deny(400));
  const otherTemplate = await models.LetterTemplate.create({ projectId: privateProject, name: 'Private', subject: template.subject, content: template.content, category: 'other' });
  await assert.rejects(() => letters.sendLetter({ ...body, requestKey: `h05-private-${new Types.ObjectId()}`, templateId: otherTemplate.id }, actor), deny(400));
  const legacy = await letters.sendLetter({ ...body, requestKey: `h05-legacy-${new Types.ObjectId()}`, templateId: undefined }, actor);
  assert.equal(legacy.letter.templateId, undefined);
  assert.equal(legacy.letter.templateNameSnapshot, undefined);
  await models.LetterTemplate.updateOne({ _id: template._id }, { $set: { name: 'Renamed', content: '<p>new</p>' } });
  assert.equal((await models.DevelopmentLetter.findById(draft.letter.id))?.templateNameSnapshot, 'Product intro');
  assert.equal((await models.DevelopmentLetter.findById(draft.letter.id))?.templateContentHash, hash(template.subject, template.content));
});

test('H-05 project/window scoped performance counts unique customers and explains denominators without fake legacy attribution', async () => {
  const tpl = await models.LetterTemplate.create({ projectId: project, name: 'Campaign H05', subject: 'H05', content: '<p>Campaign</p>', category: 'other' });
  const cust = await models.Customer.create({ projectId: project, ownerId: owner, name: 'Campaign Buyer', email: 'campaign.h05@fixture.test', status: 'won', source: 'manual' });
  const otherCust = await models.Customer.create({ projectId: privateProject, ownerId: other, name: 'Secret', email: 'secret.h05@fixture.test', source: 'manual' });
  const at = new Date(Date.now() - 2 * 86400000);
  const letter = { projectId: project, customerId: cust._id, recipientEmail: cust.email, recipientName: cust.name,
    subject: 'H05', content: '<p>Campaign</p>', template: '<p>Campaign</p>', contentText: 'Campaign', channel: 'mock', status: 'sent', sentAt: at, threadId: 'h05-thread',
    templateId: tpl._id, templateNameSnapshot: tpl.name, templateContentHash: hash(tpl.subject, tpl.content) };
  await models.DevelopmentLetter.insertMany([letter, { ...letter, requestKey: 'h05-unique-second' }, { ...letter, templateId: undefined, templateNameSnapshot: undefined, templateContentHash: undefined }]);
  await models.DevelopmentLetter.create({ ...letter, projectId: privateProject, customerId: otherCust._id, recipientEmail: otherCust.email,
    templateNameSnapshot: 'SECRET' });
  await MailMessage.insertMany([0, 1].map((n) => ({ projectId: project, customerId: cust._id, dedupKey: `h05-reply-${n}`, threadId: 'h05-thread',
    messageId: `<h05-reply-${n}@fixture.test>`, from: cust.email, to: ['sales@fixture.test'], subject: 'Re: H05', text: 'Thanks', sentAt: new Date(at.getTime() + (n + 1) * 3600000) })));
  await models.CustomerEvent.create({ projectId: project, customerId: cust._id, type: 'status_changed', at: new Date(at.getTime() + 3600000), toStatus: 'won' });
  const summary = await performance.getTemplatePerformanceSummary(30, actor, 5);
  const row = summary.templates.find((r) => r.templateId === tpl.id);
  assert.equal(summary.unattributed, 1);
  assert.equal(summary.templates.some((r) => r.templateNameSnapshot === 'SECRET'), false);
  assert.equal(row?.metrics.sent, 2);
  assert.equal(row?.sampleSize, 1);
  assert.equal(row?.metrics.replied, 1);
  assert.equal(row?.metrics.won, 1);
  assert.equal(row?.rates.replied.denominator, 1);
  assert.equal(row?.insufficientSample, true);
  assert.match(summary.correlationDisclaimer, /相关|因果/);
  await assert.rejects(() => performance.getTemplatePerformanceSummary(30, cross), deny(404));
  await models.Customer.updateOne({ _id: cust._id }, { $set: { status: 'lost' } });
  assert.equal((await performance.getTemplatePerformanceSummary(30, actor)).templates.find((r) => r.templateId === tpl.id)?.metrics.won, 0);
  await models.LetterTemplate.deleteOne({ _id: tpl._id });
  const afterDelete = await performance.getTemplatePerformanceSummary(30, actor);
  assert.equal(afterDelete.templates.find((r) => r.templateId === tpl.id)?.deleted, true);
  assert.equal(afterDelete.templates.find((r) => r.templateId === tpl.id)?.templateNameSnapshot, 'Campaign H05');
  const oldLetter = await models.DevelopmentLetter.create({ ...letter, sentAt: new Date(Date.now() - 210 * 86400000) });
  assert.ok(oldLetter.id);
  assert.equal((await performance.getTemplatePerformanceSummary(180, actor)).templates.find((r) => r.templateId === tpl.id)?.metrics.sent, 2);
});

test('H-05 suggestion preview never changes source; explicit concurrent confirmation creates just one independently auditable copy', async () => {
  const template = await models.LetterTemplate.create({ projectId: project, name: 'Keep Source', subject: 'Source Subject', content: '<p>Original</p>', category: 'product' });
  const key = `h05-suggest-${new Types.ObjectId()}`;
  const preview = await suggestions.generateTemplateSuggestion(template.id, { idempotencyKey: key }, actor);
  assert.equal(preview.model, 'rule-based-v1');
  assert.equal(preview.status, 'preview');
  assert.equal(preview.sourceSummary.referenceTemplateId, template.id);
  assert.notEqual(preview.suggested.subject, template.subject);
  assert.notEqual(preview.suggested.content, template.content);
  assert.equal((await suggestions.generateTemplateSuggestion(template.id, { idempotencyKey: key }, actor)).id, preview.id);
  assert.equal(await models.LetterTemplate.countDocuments({ sourceSuggestionId: new Types.ObjectId(preview.id) }), 0);
  assert.equal((await models.LetterTemplate.findById(template._id))?.content, '<p>Original</p>');
  await assert.rejects(() => suggestions.getTemplateSuggestion(template.id, preview.id, cross), deny(404));
  await assert.rejects(() => suggestions.getTemplateSuggestion(template.id, preview.id, another), deny(404));
  const confirm = { expectedVersion: preview.version, requestKey: `h05-confirm-${new Types.ObjectId()}` };
  const results = await Promise.allSettled([suggestions.confirmTemplateSuggestionCopy(template.id, preview.id, confirm, actor),
    suggestions.confirmTemplateSuggestionCopy(template.id, preview.id, confirm, actor)]);
  assert.ok(results.some((r) => r.status === 'fulfilled'));
  const copied = await suggestions.confirmTemplateSuggestionCopy(template.id, preview.id, confirm, actor);
  assert.equal(copied.status, 'copied');
  assert.equal(await models.LetterTemplate.countDocuments({ sourceSuggestionId: new Types.ObjectId(preview.id) }), 1);
  assert.equal((await models.LetterTemplate.findById(template._id))?.content, '<p>Original</p>');
  assert.notEqual(copied.createdTemplateId, template.id);
  const copy = await models.LetterTemplate.findById(copied.createdTemplateId);
  assert.notEqual(copy?.content, '<p>Original</p>');
  assert.match(copy?.content ?? '', /Original/);
  assert.match(copy?.content ?? '', /具体需求/);
  assert.ok(!JSON.stringify(copied).includes('OPENAI_API_KEY'));
  const next = await suggestions.generateTemplateSuggestion(template.id, { idempotencyKey: `h05-cancel-${new Types.ObjectId()}` }, actor);
  assert.equal((await suggestions.cancelTemplateSuggestion(template.id, next.id, actor)).status, 'cancelled');
  assert.equal(await models.LetterTemplate.countDocuments({ sourceSuggestionId: new Types.ObjectId(next.id) }), 0);
  const stale = await suggestions.generateTemplateSuggestion(template.id, { idempotencyKey: `h05-stale-${new Types.ObjectId()}` }, actor);
  await models.LetterTemplate.updateOne({ _id: template._id }, { $set: { subject: 'Changed by human' } });
  await assert.rejects(() => suggestions.confirmTemplateSuggestionCopy(template.id, stale.id,
    { expectedVersion: stale.version, requestKey: `h05-stale-confirm-${new Types.ObjectId()}` }, actor), deny(409));
  assert.equal(await models.LetterTemplate.countDocuments({ sourceSuggestionId: new Types.ObjectId(stale.id) }), 0);
});
