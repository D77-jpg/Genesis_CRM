/**
 * First-use checklist for a project workspace.
 *
 * The checklist is intentionally derived from real data instead of being a
 * local wizard flag: a project only looks "ready" when the underlying records
 * actually exist. Completing the checklist records the acknowledgement used by
 * the dashboard banner, but never hides an unfinished step.
 */
import { Types } from 'mongoose';
import { AgentAiSettings, Product, Project, ProjectPlaybook, User, UserMailAccount } from '../models';
import { ApiError } from '../utils/ApiError';
import type { AuthUser } from '../types/express';

export type OnboardingStepKey = 'brand' | 'products' | 'playbook' | 'mailbox' | 'team' | 'ai';

export interface OnboardingStep {
  key: OnboardingStepKey;
  title: { zh: string; en: string };
  description: { zh: string; en: string };
  done: boolean;
  href: string;
  optional?: boolean;
}

export interface OnboardingStatus {
  projectId: string;
  projectName: string;
  completedAt?: Date;
  /** All required data exists; the manager may now acknowledge onboarding. */
  ready: boolean;
  /** The manager explicitly finished the checklist. */
  completed: boolean;
  steps: OnboardingStep[];
  doneCount: number;
  totalCount: number;
}

function objectId(value: string): Types.ObjectId {
  if (!Types.ObjectId.isValid(value)) throw ApiError.notFound('项目不存在');
  return new Types.ObjectId(value);
}

async function assertProjectAccess(projectId: string, actor: AuthUser): Promise<void> {
  const project = await Project.findOne({ _id: objectId(projectId), status: 'active' }).select('_id').lean();
  if (!project) throw ApiError.notFound('项目不存在');
  if (actor.role === 'admin') return;
  const user = await User.findOne({ _id: actor.id, projectIds: objectId(projectId) }).select('_id').lean();
  if (!user) throw ApiError.notFound('项目不存在或无权访问');
}

export async function getOnboardingStatus(projectId: string, actor: AuthUser): Promise<OnboardingStatus> {
  await assertProjectAccess(projectId, actor);
  const pid = objectId(projectId);
  const [project, productCount, playbook, mailbox, teamCount, aiSettings] = await Promise.all([
    Project.findById(pid).select('name brandProfile onboardingCompletedAt').lean(),
    Product.countDocuments({ projectId: pid }),
    ProjectPlaybook.exists({ projectId: pid }),
    UserMailAccount.exists({ projectId: pid, status: 'active', verificationStatus: 'verified' }),
    User.countDocuments({ projectIds: pid, status: { $ne: 'disabled' } }),
    AgentAiSettings.findOne({ key: 'global' }).select('provider modelName').lean(),
  ]);
  if (!project) throw ApiError.notFound('项目不存在');

  const brand = project.brandProfile;
  const brandDone = Boolean(brand?.identity?.trim() || brand?.offerSummary?.trim());
  const steps: OnboardingStep[] = [
    {
      key: 'brand',
      title: { zh: '完善品牌与销售话术', en: 'Set up brand and sales narrative' },
      description: { zh: '填写对外身份、供应内容和签名，开发信会使用这些信息。', en: 'Add your identity, offer and signature for outgoing mail.' },
      done: brandDone,
      href: '/projects',
    },
    {
      key: 'products',
      title: { zh: '导入产品与价格', en: 'Import products and prices' },
      description: { zh: '先导入至少一个产品，报价和知识库才有可引用的数据。', en: 'Import at least one product so quotes and knowledge have a source.' },
      done: productCount > 0,
      href: '/products',
    },
    {
      key: 'playbook',
      title: { zh: '配置行业卡', en: 'Configure industry playbook' },
      description: { zh: '导入客户细分和采购偏好的话术卡，提升开发信相关性。', en: 'Import segment and buying-preference cards for more relevant outreach.' },
      done: Boolean(playbook),
      href: '/knowledge?view=playbook',
    },
    {
      key: 'mailbox',
      title: { zh: '绑定并验证发件邮箱', en: 'Connect and verify a mailbox' },
      description: { zh: '真实发送前，至少需要一个验证通过的个人发件邮箱。', en: 'At least one verified personal sender mailbox is required for live sending.' },
      done: Boolean(mailbox),
      href: '/users',
    },
    {
      key: 'team',
      title: { zh: '邀请团队成员', en: 'Invite your team' },
      description: { zh: '为销售分配项目或邀请只读成员。', en: 'Assign sales members or invite read-only teammates.' },
      done: teamCount > 1,
      href: '/users',
      optional: true,
    },
    {
      key: 'ai',
      title: { zh: '配置 AI 助手', en: 'Configure the AI assistant' },
      description: { zh: '配置服务商和模型后可生成开发信与分析。', en: 'Choose a provider and model to generate drafts and analysis.' },
      done: Boolean(aiSettings),
      href: '/ai-settings',
      optional: true,
    },
  ];
  const required = steps.filter((step) => !step.optional);
  const doneCount = required.filter((step) => step.done).length;
  return {
    projectId,
    projectName: project.name,
    completedAt: project.onboardingCompletedAt,
    ready: required.every((step) => step.done),
    completed: Boolean(project.onboardingCompletedAt),
    steps,
    doneCount,
    totalCount: required.length,
  };
}

export async function completeOnboarding(projectId: string, actor: AuthUser): Promise<OnboardingStatus> {
  await assertProjectAccess(projectId, actor);
  if (actor.role !== 'admin' && actor.role !== 'project_admin') {
    throw ApiError.forbidden('只有项目管理员可以完成初始化');
  }
  const status = await getOnboardingStatus(projectId, actor);
  if (!status.ready) {
    throw ApiError.conflict('还有必填步骤未完成，请先完成所有必填步骤');
  }
  await Project.updateOne({ _id: objectId(projectId) }, { $set: { onboardingCompletedAt: new Date() } });
  return getOnboardingStatus(projectId, actor);
}
