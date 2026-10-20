// Re-score existing candidates with the LLM (no crawling, costs a few model calls).
// Usage: npx tsx src/scripts/llm-rescore.ts --project genesis-bags --limit 20
import mongoose from 'mongoose';
import env from '../config/env';
import { Project } from '../models/Project';
import { Prospect } from '../models/Prospect';
import { ProspectingConfig } from '../models/ProspectingConfig';
import { mergeScores, scoreLeadsWithLlm } from '../services/prospecting/llm-scoring';
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
  const prospects = await Prospect.find({ projectId: project._id, status: { $in: ['ready', 'low', 'needs_contact'] } })
    .sort({ score: -1 }).limit(Number(arg('limit', '20')));
  console.log(`重新评分 ${prospects.length} 个候选…`);
  const scores = await scoreLeadsWithLlm(prospects.map((item) => ({
    domain: item.domain, name: item.name, country: item.country, snippet: item.snippet,
    excerpt: item.excerpt, emails: item.emails, contactTitle: item.contactTitle,
  })));
  let changed = 0;
  for (const prospect of prospects) {
    const rule = scoreLead({
      domain: prospect.domain, name: prospect.name, snippet: prospect.snippet, excerpt: prospect.excerpt,
      emails: prospect.emails, emailSource: prospect.emailSource, emailConfidence: prospect.emailConfidence,
      instagram: prospect.instagram, linkedin: prospect.linkedin,
    }, minScore);
    const ai = scores.get(prospect.domain.toLowerCase());
    const merged = mergeScores(rule, ai, minScore);
    prospect.score = merged.score;
    prospect.aiScore = ai?.score;
    prospect.scoreReasons = merged.reasons;
    prospect.status = merged.status;
    await prospect.save();
    if (ai) changed += 1;
    console.log(`- ${prospect.domain}: AI ${ai?.score ?? '-'} → 综合 ${merged.score} ${merged.status} ${merged.reasons[0] ?? ''}`);
  }
  console.log(`完成：${changed}/${prospects.length} 个拿到 AI 评分。`);
  await mongoose.disconnect();
}

void main().catch((error) => { console.error('rescore 失败：', error instanceof Error ? error.message : error); process.exit(1); });
