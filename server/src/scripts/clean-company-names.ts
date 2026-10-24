/**
 * 清掉公司名里的网页标题尾巴（试运行）
 * ------------------------------------------------------------------
 *   node --require ./scripts/os-user-info.cjs --import tsx src/scripts/clean-company-names.ts
 *   node --require ./scripts/os-user-info.cjs --import tsx src/scripts/clean-company-names.ts --apply
 *
 * 不带 --apply 只打印对照清单，不写库。客户名等于公司名的记录（潜客转客户、
 * 没抓到联系人）会一起改名，保持两处一致。
 */
import mongoose from 'mongoose';
import env from '../config/env';
import { Customer } from '../models';
import { cleanCompanyName, needsManualReview } from '../utils/company-name';

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  await mongoose.connect(env.MONGODB_URI, { serverSelectionTimeoutMS: 5000, socketTimeoutMS: 20000 });
  const customers = await Customer.find({}).select('name company').lean();

  let changed = 0;
  let review = 0;
  const rows: string[] = [];

  for (const customer of customers) {
    const rawCompany = (customer.company ?? '').trim();
    const rawName = (customer.name ?? '').trim();
    if (!rawCompany) continue;

    const nextCompany = cleanCompanyName(rawCompany);
    if (!nextCompany || nextCompany === rawCompany) continue;

    // 姓名当初就是照抄公司名的话，跟着一起改，避免两处不一致
    const nameWasCompany = rawName === rawCompany;
    const nextName = nameWasCompany ? nextCompany : rawName;

    // 清洗只是砍掉尾巴、剩下的仍是标题的（"… | Yankee …"、"Top Jewelry …"），
    // 交给人来定，脚本不动这些记录
    if (needsManualReview(rawCompany)) {
      review += 1;
      rows.push(`${rawCompany}\n  → ${nextCompany}（跳过，建议人工改成真公司名）`);
      continue;
    }

    changed += 1;
    rows.push(`${rawCompany}\n  → ${nextCompany}${nameWasCompany ? '（姓名同步改名）' : ''}`);

    if (apply) {
      await Customer.updateOne(
        { _id: customer._id },
        { $set: { company: nextCompany, ...(nameWasCompany ? { name: nextName } : {}) } },
      );
    }
  }

  console.log(`扫描客户 ${customers.length} 位，清洗 ${changed} 位，留给人工 ${review} 位`);
  console.log(rows.join('\n'));
  console.log(apply ? '\n已写入数据库。' : '\n（试运行，未写库；加 --apply 才会写入）');

  await mongoose.connection.close().catch(() => undefined);
}

main().catch((error) => {
  console.error('清洗失败：', error);
  process.exitCode = 1;
});
