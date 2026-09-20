import fs from 'node:fs/promises';
import mongoose from 'mongoose';
import path from 'node:path';

process.env.MAIL_TRANSPORT = 'mock';
process.env.IMAP_ENABLED = 'false';
process.env.UPLOAD_DIR = path.resolve('tmp/test-uploads');

async function main() {
  const { uri } = JSON.parse(await fs.readFile('tmp/test-db.json', 'utf8')) as { uri: string };
  if (!uri.startsWith('mongodb://127.0.0.1:')) throw new Error('Only the isolated local fixture is allowed');
  await mongoose.connect(uri);
  const { Customer, User } = await import('../src/models');
  const { sendLetter } = await import('../src/services/letter.service');
  const { importMail } = await import('../src/services/mail-sync.service');
  const admin = await User.findOne({ username: 'admin' });
  const actor = { id: String(admin!._id), role: 'admin' as const, username: admin!.username, displayName: admin!.displayName };
  const customer = await Customer.findOneAndUpdate({ email: 'mail-ui@example.com' }, { $setOnInsert: { name: '邮件中心验收客户', company: 'Mail Center Demo', ownerId: admin!._id, status: 'pending' } }, { upsert: true, new: true });
  const sent = await sendLetter({ customerId: String(customer._id), subject: 'V2.1 包装方案与样品确认', content: '<p>您好，附件中的包装方案已准备好，欢迎回复确认样品数量。</p>', markAsDeveloped: true, saveAsDraft: false, requestKey: 'mail-ui-proposal' }, actor);
  const source = Buffer.from(['From: Demo Customer <mail-ui@example.com>', 'To: sales@example.com', 'Cc: purchasing@example.com', 'Message-ID: <mail-ui-reply@fixture.test>', `In-Reply-To: ${sent.letter.messageId}`, `References: ${sent.letter.messageId}`, 'Subject: Re: V2.1 packaging proposal', 'MIME-Version: 1.0', 'Content-Type: multipart/mixed; boundary="demo"', '', '--demo', 'Content-Type: text/html; charset=utf-8', '', '<p>您好，感谢提供包装方案。</p><p>我们希望先确认 <strong>300 件样品</strong> 的交期，请参考附件中的需求。</p><script>alert("untrusted")</script><img src="https://tracker.invalid/pixel">', '--demo', 'Content-Type: text/plain', 'Content-Disposition: attachment; filename="requirements.txt"', 'Content-Transfer-Encoding: base64', '', Buffer.from('Sample quantity: 300; Colour: natural').toString('base64'), '--demo--'].join('\r\n'));
  await importMail(source, 'ui-fixture');
  await importMail(Buffer.from('From: new-inquiry@example.com\r\nTo: sales@example.com\r\nMessage-ID: <mail-ui-unknown@fixture.test>\r\nSubject: New packaging inquiry\r\n\r\nPlease share a packaging catalogue.'), 'ui-fixture');
  await sendLetter({ customerId: String(customer._id), subject: 'V2.1 定时跟进示例', content: '<p>跟进样品交期。</p>', markAsDeveloped: false, saveAsDraft: false, scheduledAt: new Date(Date.now() + 86400000), requestKey: `mail-ui-schedule-${Date.now()}` }, actor);
  console.log('Mail UI fixtures created (mock only)');
  await mongoose.disconnect();
}
void main().catch(() => { console.error('UI fixture setup failed'); process.exitCode = 1; void mongoose.disconnect(); });
