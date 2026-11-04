import assert from 'node:assert/strict';
import { test, before, after, beforeEach } from 'node:test';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import type { AuthUser } from '../src/types/express';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET ||= 'p1-onboarding-fixture-jwt-secret-0123456789abcdef';

let memory: MongoMemoryServer;
let models: typeof import('../src/models');
let getOnboardingStatus: typeof import('../src/services/onboarding.service').getOnboardingStatus;
let completeOnboarding: typeof import('../src/services/onboarding.service').completeOnboarding;
let updateProject: typeof import('../src/services/project.service').updateProject;
let getProjectComplianceSettings: typeof import('../src/services/mail-compliance.service').getProjectComplianceSettings;

function actor(role: AuthUser['role'], projectId: string): AuthUser {
  return {
    id: new mongoose.Types.ObjectId().toString(),
    username: `${role}-fixture`,
    displayName: role,
    role,
    projectId,
  };
}

before(async () => {
  memory = await MongoMemoryServer.create();
  await mongoose.connect(memory.getUri('p1_onboarding_fixture'));
  models = await import('../src/models');
  ({ getOnboardingStatus, completeOnboarding } = await import('../src/services/onboarding.service'));
  ({ updateProject } = await import('../src/services/project.service'));
  ({ getProjectComplianceSettings } = await import('../src/services/mail-compliance.service'));
});

after(async () => {
  if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
  await memory?.stop();
});

beforeEach(async () => {
  await Promise.all([
    models.Project.deleteMany({}),
    models.User.deleteMany({}),
    models.Product.deleteMany({}),
    models.ProjectPlaybook.deleteMany({}),
    models.UserMailAccount.deleteMany({}),
    models.AgentAiSettings.deleteMany({}),
  ]);
});

test('onboarding reports required data, then records explicit completion', async () => {
  const project = await models.Project.create({
    name: 'Onboarding fixture', slug: 'onboarding-fixture', code: 'ONBOARD',
    companyName: 'Onboarding fixture Co', mailProfileKey: 'general',
    brandProfile: { identity: 'We supply custom bags', offerSummary: 'MOQ-friendly manufacturing' },
  });
  const adminActor = actor('admin', String(project._id));
  await models.User.create({
    _id: adminActor.id, username: adminActor.username, passwordHash: 'fixture-hash', role: 'admin',
    projectIds: [project._id],
  });
  await models.Product.create({ projectId: project._id, sku: 'BAG-1', name: 'Sample bag' });
  await models.ProjectPlaybook.create({ projectId: project._id, segments: [], preferences: [] });
  await models.UserMailAccount.create({
    projectId: project._id, userId: adminActor.id, email: 'sender@example.test',
    smtpHost: 'smtp.example.test', smtpPort: 587, smtpUsername: 'sender@example.test',
    credentialCiphertext: 'fixture', credentialIv: 'fixture', credentialTag: 'fixture',
    status: 'active', verificationStatus: 'verified', createdBy: adminActor.id, updatedBy: adminActor.id,
  });

  const compliance = await getProjectComplianceSettings(String(project._id));
  assert.equal(compliance.trackingEnabled, true);
  await models.Project.updateOne({ _id: project._id }, { $set: { 'mailCompliance.trackingEnabled': false } });
  assert.equal((await getProjectComplianceSettings(String(project._id))).trackingEnabled, false);

  const pending = await getOnboardingStatus(String(project._id), adminActor);
  assert.equal(pending.ready, true);
  assert.equal(pending.completed, false);
  assert.equal(pending.doneCount, 4);

  const done = await completeOnboarding(String(project._id), adminActor);
  assert.equal(done.completed, true);
  assert.ok(done.completedAt instanceof Date);
});

test('project admin can edit brand, viewer cannot', async () => {
  const project = await models.Project.create({
    name: 'Brand role fixture', slug: 'brand-role-fixture', code: 'BRANDR',
    companyName: 'Brand role fixture Co', mailProfileKey: 'general',
  });
  const projectAdmin = actor('project_admin', String(project._id));
  await models.User.create({
    _id: projectAdmin.id, username: projectAdmin.username, passwordHash: 'fixture-hash', role: 'project_admin',
    projectIds: [project._id],
  });
  const updated = await updateProject(String(project._id), {
    brandProfile: { identity: 'Updated by project admin', offerSummary: 'Custom offer' },
  }, projectAdmin);
  assert.equal(updated.brandProfile?.identity, 'Updated by project admin');

  const viewer = actor('viewer', String(project._id));
  await models.User.create({
    _id: viewer.id, username: viewer.username, passwordHash: 'fixture-hash', role: 'viewer',
    projectIds: [project._id],
  });
  await assert.rejects(
    updateProject(String(project._id), { brandProfile: { identity: 'Should fail' } }, viewer),
    (error: { statusCode: number }) => error.statusCode === 403,
  );
});

test('sales and viewer cannot acknowledge onboarding', async () => {
  const project = await models.Project.create({
    name: 'Onboarding role fixture', slug: 'onboarding-role-fixture', code: 'ONBOARD2',
    companyName: 'Onboarding role fixture Co', mailProfileKey: 'general',
  });
  const viewer = actor('viewer', String(project._id));
  await models.User.create({
    _id: viewer.id, username: viewer.username, passwordHash: 'fixture-hash', role: 'viewer',
    projectIds: [project._id],
  });
  await assert.rejects(
    completeOnboarding(String(project._id), viewer),
    (error: { statusCode: number }) => error.statusCode === 403,
  );
});
