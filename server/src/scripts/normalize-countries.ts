/**
 * 一次性数据归一：把客户表里的国家写法统一成中文简称（英国 / 美国 …）。
 *
 * 用法：
 *   npx tsx src/scripts/normalize-countries.ts            # 只看会改成什么（dry run）
 *   npx tsx src/scripts/normalize-countries.ts --apply    # 真正写库
 *
 * 规则来自 src/utils/country.ts；识别不了的写法原样保留，只打印出来供人工确认。
 */
import mongoose from 'mongoose';
import env from '../config/env';
import { Customer } from '../models';
import { isKnownCountry, normalizeCountry } from '../utils/country';

const apply = process.argv.includes('--apply');

async function main() {
  await mongoose.connect(env.MONGODB_URI, { serverSelectionTimeoutMS: 5000, socketTimeoutMS: 20000 });
  const docs = await Customer.find({ country: { $exists: true, $nin: [null, ''] } })
    .select('name country projectId')
    .lean();
  const changes = new Map<string, string>();
  const unknown = new Map<string, number>();
  let touched = 0;

  for (const doc of docs as unknown as { _id: mongoose.Types.ObjectId; name: string; country: string }[]) {
    const raw = String(doc.country ?? '');
    const next = normalizeCountry(raw);
    if (!next) continue;
    if (!isKnownCountry(raw)) unknown.set(raw, (unknown.get(raw) ?? 0) + 1);
    if (next === raw) continue;
    changes.set(raw, next);
    touched += 1;
    if (apply) await Customer.updateOne({ _id: doc._id }, { $set: { country: next } });
  }

  console.log(`扫描客户：${docs.length} 位，需要改写：${touched} 位${apply ? '（已写入）' : '（dry run，未写入）'}`);
  if (changes.size > 0) {
    console.log('\n写法 → 统一值：');
    [...changes.entries()].sort().forEach(([from, to]) => console.log(`  ${from} → ${to}`));
  }
  if (unknown.size > 0) {
    console.log('\n未能识别的写法（原样保留，建议人工确认或补充到 country.ts 别名表）：');
    [...unknown.entries()].sort().forEach(([value, count]) => console.log(`  ${value}（${count} 位）`));
  }
  await mongoose.disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await mongoose.disconnect();
  process.exit(1);
});
