/**
 * 客户查重契约测试
 * ------------------------------------------------------------------
 *  1. 归一化：公司名去后缀、网站取域名、电话取后 9 位；
 *  2. 判定口径：邮箱/网站 = 硬冲突，公司名/电话 = 软提醒；
 *  3. 真实库：跨项目不串、转客户时同网站算硬冲突、导入批量索引能命中；
 *  4. 断言函数直接抛 409，并指出撞的是哪一位客户。
 */
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { Types } from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

let memory: MongoMemoryServer;
let mongoose: typeof import('mongoose');
let projectA: string;
let projectB: string;

type Mods = {
  duplicate: typeof import('../src/services/customer-duplicate');
  models: typeof import('../src/models');
};
let mods: Mods;

before(async () => {
  memory = await MongoMemoryServer.create();
  mongoose = await import('mongoose');
  await mongoose.default.connect(memory.getUri(), { dbName: 'customer-dedup' });
  const models = await import('../src/models');
  const duplicate = await import('../src/services/customer-duplicate');
  mods = { duplicate, models };
  const a = await models.Project.create({ name: 'A', slug: 'dedupe-a', code: 'DA', companyName: 'A', mailProfileKey: 'a', isDefault: true });
  const b = await models.Project.create({ name: 'B', slug: 'dedupe-b', code: 'DB', companyName: 'B', mailProfileKey: 'b' });
  projectA = a.id as string;
  projectB = b.id as string;
  await models.Customer.create([
    { projectId: a._id, name: 'Monarc Jewellery', company: 'Monarc Jewellery Ltd', email: 'ella@monarcjewellery.com', website: 'https://monarcjewellery.com', phone: '+44 20 7946 0011', status: 'pending' },
    { projectId: a._id, name: 'Nadine Attar', company: 'Nadine Jewellery', email: 'info@nadinejewellery.com', website: 'https://nadinejewellery.com', phone: '+966 11 555 0100', status: 'pending' },
    // 另一个项目里同邮箱：判重不能串项目
    { projectId: b._id, name: 'Other Project Shop', company: 'Other Project Shop', email: 'ella@monarcjewellery.com', website: 'https://monarcjewellery.com', status: 'pending' },
  ]);
});

after(async () => {
  await mongoose.default.disconnect();
  await memory.stop();
});

test('公司名归一：去公司后缀、去符号、不分大小写', () => {
  const { companyKey } = mods.duplicate;
  assert.equal(companyKey('Monarc Jewellery Ltd'), companyKey('monarc jewellery'));
  assert.equal(companyKey('Acme Co., Ltd.'), 'acme');
  assert.equal(companyKey('Nadine  Jewellery®'), 'nadine jewellery');
  assert.equal(companyKey('深圳某某饰品有限公司'), '深圳某某饰品有限公司');
});

test('网站取域名、电话取后 9 位', () => {
  const { websiteHost, phoneKey } = mods.duplicate;
  assert.equal(websiteHost('https://www.MonarcJewellery.com/pages/x'), 'monarcjewellery.com');
  assert.equal(websiteHost('monarcjewellery.com'), 'monarcjewellery.com');
  assert.equal(websiteHost(''), '');
  assert.equal(phoneKey('+44 20 7946 0011'), '079460011');
  assert.equal(phoneKey('020 7946 0011'), '079460011');
  assert.equal(phoneKey('123'), '');
});

test('判定口径：邮箱和网站是硬冲突，公司名和电话是软提醒', () => {
  const { matchDuplicates } = mods.duplicate;
  const candidates = [
    { _id: 'c1', name: 'Monarc Jewellery', company: 'Monarc Jewellery Ltd', email: 'ella@monarcjewellery.com', website: 'https://monarcjewellery.com', phone: '+44 20 7946 0011' },
  ];
  assert.equal(matchDuplicates(candidates, { email: 'ELLA@monarcjewellery.com' }).hard[0]?.matched, 'email');
  assert.equal(matchDuplicates(candidates, { website: 'www.monarcjewellery.com' }).hard[0]?.matched, 'website');
  assert.equal(matchDuplicates(candidates, { company: 'monarc jewellery' }).soft[0]?.matched, 'company');
  assert.equal(matchDuplicates(candidates, { phone: '020 7946 0011' }).soft[0]?.matched, 'phone');
  assert.deepEqual(matchDuplicates(candidates, { email: 'a@b.com', company: '完全不同' }), { hard: [], soft: [] });
});

test('真实库：同邮箱命中、跨项目不串', async () => {
  const { findCustomerDuplicates } = mods.duplicate;
  const hit = await findCustomerDuplicates(projectA, { email: 'ella@monarcjewellery.com' });
  assert.equal(hit.hard.length, 1);
  assert.equal(hit.hard[0]?.name, 'Monarc Jewellery');

  // 项目 B 里同邮箱的客户不能算进项目 A
  const scoped = await findCustomerDuplicates(projectA, { email: 'ella@monarcjewellery.com' });
  assert.ok(scoped.hard.every((item) => item.name !== 'Other Project Shop'));
});

test('真实库：转客户口径下同网站是硬冲突，手工新建口径下只提醒', async () => {
  const { findCustomerDuplicates } = mods.duplicate;
  const strict = await findCustomerDuplicates(projectA, { website: 'https://monarcjewellery.com', email: 'second@monarcjewellery.com' }, { strictDomain: true });
  assert.equal(strict.hard.length, 1);

  const loose = await findCustomerDuplicates(projectA, { website: 'https://monarcjewellery.com', email: 'second@monarcjewellery.com' }, { strictDomain: false });
  assert.equal(loose.hard.length, 0);
  assert.equal(loose.soft[0]?.matched, 'website');
});

test('真实库：同公司名不同邮箱 → 软提醒', async () => {
  const { findCustomerDuplicates } = mods.duplicate;
  const report = await findCustomerDuplicates(projectA, { company: 'Monarc Jewellery Ltd', email: 'another@monarc.example' }, { strictDomain: true });
  assert.equal(report.hard.length, 0);
  assert.equal(report.soft[0]?.name, 'Monarc Jewellery');
  assert.equal(report.soft[0]?.matched, 'company');
});

test('真实库：断言函数抛 409 并指出撞上谁', async () => {
  const { assertNoCustomerDuplicate } = mods.duplicate;
  await assert.rejects(
    () => assertNoCustomerDuplicate(projectA, { email: 'info@nadinejewellery.com' }, { strictDomain: true }),
    (error: unknown) => {
      const apiError = error as { statusCode?: number; message?: string; details?: { field?: string; message?: string }[] };
      assert.equal(apiError.statusCode, 409);
      assert.match(String(apiError.message), /Nadine Attar/);
      assert.ok(apiError.details?.some((detail) => detail.field === 'duplicateCustomerId'));
      return true;
    },
  );
});

test('真实库：导入用的批量索引能命中邮箱/网站/公司名/电话', async () => {
  const { buildDuplicateIndex, lookupDuplicate } = mods.duplicate;
  const index = await buildDuplicateIndex(projectA, [
    { email: 'ella@monarcjewellery.com' },
    { website: 'https://nadinejewellery.com' },
    { company: 'Nadine Jewellery' },
    { phone: '+966 11 555 0100' },
  ]);
  assert.equal(lookupDuplicate(index, { email: 'ella@monarcjewellery.com' }).hard?.name, 'Monarc Jewellery');
  assert.equal(lookupDuplicate(index, { website: 'nadinejewellery.com' }).hard?.name, 'Nadine Attar');
  assert.equal(lookupDuplicate(index, { company: 'Nadine Jewellery', email: 'new@nadine.example' }).soft?.name, 'Nadine Attar');
  assert.equal(lookupDuplicate(index, { phone: '011 555 0100', email: 'x@y.example' }).soft?.name, 'Nadine Attar');
  assert.equal(lookupDuplicate(index, { website: 'brand-new.example', email: 'hi@brand-new.example' }).hard, undefined);
});

test('真实库：空输入不误报', async () => {
  const { findCustomerDuplicates } = mods.duplicate;
  assert.deepEqual(await findCustomerDuplicates(projectA, {}), { hard: [], soft: [] });
  assert.deepEqual(await findCustomerDuplicates(String(new Types.ObjectId()), { email: 'ella@monarcjewellery.com' }), { hard: [], soft: [] });
});
