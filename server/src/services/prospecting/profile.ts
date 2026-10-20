// The scoring rubric is project data: prefer the published 《客户画像》 entry,
// fall back to the built-in summary when the project has not uploaded one.
import { Types } from 'mongoose';
import { AgentKnowledge } from '../../models/AgentKnowledge';

export const PROFILE_TITLE = /客户画像|理想客户|目标客户|ICP|customer profile|target profile/i;

export interface ProfileEntry {
  title: string;
  content: string;
}

export function pickProfile(entries: ProfileEntry[], maxChars = 6000): ProfileEntry | null {
  const byTitle = entries.find((entry) => PROFILE_TITLE.test(entry.title));
  const byBody = entries.find((entry) => entry.content.slice(0, 600).includes('客户画像'));
  const hit = byTitle ?? byBody;
  return hit ? { title: hit.title, content: hit.content.slice(0, maxChars) } : null;
}

export function pickProfileText(entries: ProfileEntry[], maxChars = 6000): string | null {
  return pickProfile(entries, maxChars)?.content ?? null;
}

export async function loadProfile(projectId: Types.ObjectId, maxChars = 6000): Promise<ProfileEntry | null> {
  const docs = await AgentKnowledge.find({ projectId, archived: false, approvedVersion: { $gt: 0 } }).lean();
  const entries = docs.flatMap((doc) => {
    const revision = doc.revisions.find((item) => item.version === doc.approvedVersion && item.approved);
    return revision ? [{ title: revision.title, content: revision.content }] : [];
  });
  return pickProfile(entries, maxChars);
}

export async function loadProfileText(projectId: Types.ObjectId, maxChars = 6000): Promise<string | null> {
  return (await loadProfile(projectId, maxChars))?.content ?? null;
}
