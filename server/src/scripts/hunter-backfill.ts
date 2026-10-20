// One-off backfill: fill missing emails for existing candidates with Hunter.
// Spends Hunter credits (1 per domain). Usage:
//   npx tsx src/scripts/hunter-backfill.ts --project genesis-bags --limit 12
import mongoose from 'mongoose';
import env from '../config/env';
import { Project } from '../models/Project';
import { Prospect } from '../models/Prospect';
import { ProspectingConfig } from '../models/ProspectingConfig';
import { hunterDomainSearch } from '../services/prospecting/hunter';
import { scoreLead } from '../services/prospecting/scoring';

void env;

function arg(name: string, fallback: string) {
  const index = process.argv.indexOf(`--${name}`);
  return index > -1 ? process.argv[index + 1] : fallback;
}

async function main() {
  await mongoose.connect(process.env.MONGODB_URI ?? 'mongodb://127.0.0.1:27017/cdlm');
  const project = await Project.findOne({ slug: arg('project', 'genesis-bags') }).lean();
  if (!project) throw new Error('项目不存在');
  const config = await ProspectingConfig.findOne({ projectId: project._id }).lean();
  const minScore = config?.minScore ?? 60;
  const limit = Number(arg('limit', '10'));
  const prospects = await Prospect.find({ projectId: project._id, emails: { $size: 0 }, status: { $in: ['needs_contact', 'low'] } })
    .sort({ score: -1 }).limit(limit);
  console.log(`待补邮箱 ${prospects.length} 个，开始查询 Hunter（本次最多消耗 ${prospects.length} credits）`);
  let found = 0;
  let spent = 0;
  for (const prospect of prospects) {
    try {
      const result = await hunterDomainSearch(prospect.domain);
      spent += 1;
      if (!result.emails.length) { console.log(`- ${prospect.domain}: 没有公开邮箱`); continue; }
      const scored = scoreLead({
        domain: prospect.domain, name: prospect.name ?? undefined, snippet: prospect.snippet ?? undefined,
        excerpt: prospect.excerpt ?? undefined, emails: result.emails.slice(0, 3).map((item) => item.value),
        emailSource: 'hunter', emailConfidence: result.emails[0].confidence, instagram: prospect.instagram ?? undefined,
      }, minScore);
      prospect.emails = result.emails.slice(0, 3).map((item) => item.value);
      prospect.emailSource = 'hunter';
      prospect.emailConfidence = result.emails[0].confidence;
      prospect.contactName = result.contactName;
      prospect.contactTitle = result.contactTitle;
      prospect.score = scored.score;
      prospect.scoreReasons = scored.reasons;
      prospect.status = scored.status;
      await prospect.save();
      found += 1;
      console.log(`- ${prospect.domain}: ${prospect.emails[0]} (${result.emails[0].confidence}%) → ${scored.status} ${scored.score}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`- ${prospect.domain}: ${message}`);
      if (/额度|无效|频繁|credit/i.test(message)) break;
    }
  }
  console.log(`完成：查询 ${spent} 个域名，补到 ${found} 个邮箱。`);
  await mongoose.disconnect();
}

void main().catch((error) => { console.error('backfill 失败：', error instanceof Error ? error.message : error); process.exit(1); });
