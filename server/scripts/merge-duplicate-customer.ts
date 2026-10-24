/**
 * 合并重复客户：Claudia Cho（cc@bimbotech.co 保留，claudiachoxo@gmail.com 并入）
 * 用法（在 server 目录下执行）：
 *   node --import tsx scripts/merge-duplicate-customer.ts           # 只出预演
 *   node --import tsx scripts/merge-duplicate-customer.ts --apply    # 真正执行
 */
import mongoose from 'mongoose';
import fs from 'node:fs';
import path from 'node:path';
import env from '../src/config/env';
import { Customer } from '../src/models/Customer';
import { MailMessage } from '../src/models/MailMessage';
import { DevelopmentLetter } from '../src/models/DevelopmentLetter';
import { Quotation } from '../src/models/Quotation';
import { CustomerEvent } from '../src/models/CustomerEvent';
import { CustomerAttachment } from '../src/models/CustomerAttachment';
import { FollowUp } from '../src/models/FollowUp';
import { AgentCustomerAnalysis } from '../src/models/AgentCustomerAnalysis';
import { AgentMailThreadAnalysis } from '../src/models/AgentMailThreadAnalysis';
import { AgentTask } from '../src/models/AgentTask';
import { Prospect } from '../src/models/Prospect';
import { CustomerAgreement } from '../src/models/CustomerAgreement';

const APPLY = process.argv.includes('--apply');
const KEEP_ID = '6ada67dc7a82bccb4795fadc';   // cc@bimbotech.co
const MERGE_ID = '6ada67dc7a82bccb4795fae5';  // claudiachoxo@gmail.com
const MERGED_EMAIL = 'claudiachoxo@gmail.com';
const OUT = path.resolve(__dirname, '../../.dsh/merge-report.txt');

const LINKED: [string, any][] = [
  ['MailMessage', MailMessage], ['DevelopmentLetter', DevelopmentLetter], ['Quotation', Quotation],
  ['CustomerEvent', CustomerEvent], ['CustomerAttachment', CustomerAttachment], ['FollowUp', FollowUp],
  ['AgentCustomerAnalysis', AgentCustomerAnalysis], ['AgentMailThreadAnalysis', AgentMailThreadAnalysis],
  ['AgentTask', AgentTask], ['Prospect', Prospect], ['CustomerAgreement', CustomerAgreement],
];

async function main(): Promise<void> {
  await mongoose.connect(env.MONGODB_URI, { serverSelectionTimeoutMS: 6000 });
  const log: string[] = [];
  const say = (line: string) => { log.push(line); console.log(line); };

  const keep = await Customer.findById(KEEP_ID).lean() as any;
  const merge = await Customer.findById(MERGE_ID).lean() as any;
  if (!keep || !merge) throw new Error('找不到待合并的两条客户记录');
  if (String(keep.email).toLowerCase() !== 'cc@bimbotech.co' || String(merge.email).toLowerCase() !== MERGED_EMAIL) {
    throw new Error(`客户记录校验失败：keep=${keep.email} merge=${merge.email}`);
  }
  say(`保留：${keep.name} <${keep.email}> ${KEEP_ID}`);
  say(`并入：${merge.name} <${merge.email}> ${MERGE_ID}`);
  say(`模式：${APPLY ? '执行' : '预演'}`);

  // 1) 关联数据迁移
  for (const [label, model] of LINKED) {
    const count = await (model as any).countDocuments({ customerId: merge._id });
    if (!count) continue;
    say(`  迁移 ${label}: ${count} 条`);
    if (APPLY) await (model as any).updateMany({ customerId: merge._id }, { $set: { customerId: keep._id } });
  }

  // 2) 未关联但来自同一邮箱的来信，挂到保留记录上
  const unlinked = await MailMessage.countDocuments({
    projectId: keep.projectId,
    customerId: null,
    from: new RegExp(MERGED_EMAIL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'),
  });
  if (unlinked) {
    say(`  未关联来信（${MERGED_EMAIL}）：${unlinked} 封 → 挂到保留记录`);
    if (APPLY) {
      await MailMessage.updateMany(
        { projectId: keep.projectId, customerId: null, from: new RegExp(MERGED_EMAIL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') },
        { $set: { customerId: keep._id } },
      );
    }
  }

  // 3) 合并字段：只补空值，标签取并集
  const patch: any = {};
  for (const field of ['company', 'industry', 'country', 'website', 'phone', 'contactName', 'address', 'position', 'requirementNotes', 'grade']) {
    if (!keep[field] && merge[field]) patch[field] = merge[field];
  }
  const tags = [...new Set([...(keep.tags ?? []), ...(merge.tags ?? [])])];
  if (tags.length !== (keep.tags ?? []).length) patch.tags = tags;

  // 4) 备注重写：按合并后的真实邮件数写清楚，并注明并入的邮箱
  const mails = await MailMessage.find({ projectId: keep.projectId, customerId: keep._id }).sort({ sentAt: -1 }).select('subject sentAt').lean() as any[];
  if (!APPLY) {
    // 预演时迁移还没发生，把将并入的来信一起算进合计，数字才和实际一致
    const incoming = await MailMessage.find({ projectId: keep.projectId, customerId: merge._id }).select('subject sentAt').lean() as any[];
    for (const mail of incoming) if (!mails.some((m) => String(m._id) === String(mail._id))) mails.push(mail);
    const orphans = await MailMessage.find({
      projectId: keep.projectId,
      customerId: null,
      from: { $regex: MERGED_EMAIL, $options: 'i' },
    }).select('subject sentAt').lean() as any[];
    for (const mail of orphans) if (!mails.some((m) => String(m._id) === String(mail._id))) mails.push(mail);
    mails.sort((a, b) => new Date(b.sentAt).getTime() - new Date(a.sentAt).getTime());
  }
  const latest = mails[0]?.sentAt ? new Date(mails[0].sentAt).toISOString().slice(0, 10) : '-';
  const firstSubject = [...mails].reverse().find((m) => m.subject)?.subject ?? '-';
  patch.notes = [
    `来源：邮件往来（客户主动来信，共 ${mails.length} 封）`,
    `最近来信：${latest}`,
    `首个主题：${firstSubject}`,
    `已合并重复档案：${MERGED_EMAIL}`,
    '档案里的联系人/公司名由邮箱和发件人自动生成，请按实际核对后补全。',
  ].join('\n');

  say(`  字段补齐：${Object.keys(patch).filter((k) => k !== 'notes').join('、') || '无'}`);
  say(`  备注会重写为：${patch.notes.replace(/\n/g, ' / ')}`);
  if (APPLY) await Customer.updateOne({ _id: keep._id }, { $set: patch });

  // 5) 删除重复记录
  if (APPLY) await Customer.deleteOne({ _id: merge._id });
  say(`  ${APPLY ? '已删除' : '将删除'}重复记录 ${MERGE_ID}`);

  // 6) 校验
  if (APPLY) {
    const left = await Customer.countDocuments({ projectId: keep.projectId });
    const mailCount = await MailMessage.countDocuments({ customerId: keep._id });
    const dangling = [] as string[];
    for (const [label, model] of LINKED) {
      const count = await (model as any).countDocuments({ customerId: merge._id });
      if (count) dangling.push(`${label}:${count}`);
    }
    say(`  校验：客户总数 ${left} · 保留记录来信 ${mailCount} 封 · 残留引用 ${dangling.join(',') || '无'}`);
  }

  fs.writeFileSync(OUT, log.join('\n'), 'utf8');
  await mongoose.connection.close();
}

main().catch(async (error) => { console.error('ERR', error); await mongoose.connection.close().catch(() => {}); process.exit(1); });
