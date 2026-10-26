/**
 * 发送前检查（原「依据与风险」）
 * ------------------------------------------------------------------
 * 业务员打开草稿只看一件事：**现在能不能发**。
 * 所以这里不再罗列「承诺数 / 引用依据 / 检索状态」这类内部指标，而是给出待办清单：
 *   一条要确认的事 = 一行，说人话 + 直接给按钮（核对当前修改 / 重新生成）。
 * 都通过时只显示一句「检查通过」，内部明细全部收进折叠区。
 */
import { KnowledgeCitation } from './knowledge-citation';
import * as React from 'react';
import {
  CheckCircle2,
  ChevronRight,
  FileSearch,
  Loader2,
  RefreshCw,
  ShieldCheck,
  TriangleAlert,
} from 'lucide-react';
import { apiGet, apiPost, toErrorMessage } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { createClientId, cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { policyTopics } from '@/types/knowledge';
import type { KnowledgeReview, KnowledgeFreshness, FactCheck } from '@/types/knowledge';

const policyName = (s: string) => policyTopics[s as keyof typeof policyTopics] ?? s;

interface EvidenceResult {
  subject?: string;
  knowledgeReview?: KnowledgeReview;
  knowledgeFreshness?: KnowledgeFreshness;
  reviewBodyChanged?: boolean;
}

/** 内部检索状态 → 业务员看得懂的一句话 */
const stateLabels: Record<string, string> = {
  index_not_ready: '资料还没准备好',
  index_stale: '资料需要更新',
  ready: '资料已核对',
  no_match: '没找到可引用的资料',
  expired: '相关资料已过期',
  conflict: '资料之间有冲突',
  retrieval_failed: '资料检索失败',
};

const statusActions: Record<string, string> = {
  index_not_ready: '请管理员进入「知识库 → 检索准备」准备资料后再生成。',
  index_stale: '请管理员更新检索资料，再按最新依据重新生成。',
  no_match: '可以缩小产品或问题范围，或请管理员补充并发布相关资料。',
  expired: '请业务负责人确认新政策，更新有效期后再用。',
  conflict: '先请业务负责人核对冲突来源，确认前不要对外承诺。',
  retrieval_failed: '稍后重试即可；当前草稿只保留了有依据的部分。',
};

const checkStatusLabels: Record<FactCheck['status'], string> = {
  supported: '有依据',
  unsupported: '缺少依据',
  contradicted: '与依据矛盾',
  unverifiable: '需确认',
  non_claim: '非业务承诺',
};

const factStatusLabels: Record<string, string> = {
  applicable: '适用',
  needs_confirmation: '待确认',
  not_applicable: '本次不适用',
  expired: '未生效或已失效',
  conflict: '来源冲突',
};

const questionLabels: Record<string, string> = {
  'Minimum order quantity': '起订量',
  'Production lead time': '生产交期',
  'Sample policy': '样品政策',
  Price: '价格',
  Shipping: '物流与运费',
  Payment: '付款',
  Certification: '认证',
  'Trade terms': '贸易条款',
  Capacity: '产能',
  'Product details': '产品细节',
};

/** 把内部措辞翻成人话 */
const plainReason = (reason: string) =>
  reason
    .replace(/[，,]?\s*请重新生成。?/g, '')
    .replace(/官网调查快照已变化或当前不可访问/g, '官网快照打不开或有变化')
    .replace(/已发生变化/g, '有变化')
    .trim();

const clip = (text: string, max = 42) => (text.length > max ? `${text.slice(0, max)}…` : text);

/** 待确认事项：一行一件事，能点的直接给按钮 */
interface Todo {
  key: string;
  title: string;
  detail?: string;
  bullets?: string[];
  action?: 'recheck' | 'regenerate';
}

export function KnowledgeReviewPanel({
  review,
  freshness,
  letterId,
  analysisId,
  currentBody,
  currentSubject,
}: {
  currentBody?: string;
  currentSubject?: string;
  review?: KnowledgeReview;
  freshness?: KnowledgeFreshness;
  letterId?: string;
  analysisId?: string;
}) {
  const [audit, setAudit] = React.useState<{ mode: string; checks: FactCheck[]; bodyHash: string } | null>(null);
  const [editingChanged, setEditingChanged] = React.useState(false);
  const [auditing, setAuditing] = React.useState(false);
  const editingIdentity = JSON.stringify([letterId, currentSubject, currentBody]);
  const latestEditing = React.useRef(editingIdentity);
  latestEditing.current = editingIdentity;
  React.useEffect(() => setAudit(null), [currentBody, currentSubject, letterId]);

  const [loaded, setLoaded] = React.useState<EvidenceResult>({});
  const [error, setError] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [next, setNext] = React.useState<{ letterId: string; customerId: string } | null>(null);
  const requestKey = React.useRef(createClientId());

  React.useEffect(() => {
    setLoaded({});
    setNext(null);
    setError('');
    requestKey.current = createClientId();
    if (!letterId && !analysisId) return;
    let active = true;
    void apiGet<EvidenceResult>(letterId ? '/letters/' + letterId : '/agent/customer-analyses/' + analysisId)
      .then((data) => { if (active) setLoaded(data); })
      .catch((e) => { if (active) setError(toErrorMessage(e, '无法读取这封草稿的依据，请稍后重试')); });
    return () => { active = false; };
  }, [letterId, analysisId]);

  async function refreshEvidence() {
    if (!letterId) return;
    setBusy(true);
    setError('');
    try {
      setLoaded(await apiGet<EvidenceResult>('/letters/' + letterId));
    } catch (e) {
      setError(toErrorMessage(e, '暂时查不到资料状态，请稍后重试'));
    } finally {
      setBusy(false);
    }
  }

  const value = loaded.knowledgeReview ?? review;
  const current = loaded.knowledgeFreshness ?? freshness;

  React.useEffect(() => {
    let active = true;
    if (currentBody === undefined || !value) {
      setEditingChanged(false);
      return;
    }
    if (!globalThis.crypto?.subtle) {
      setEditingChanged(true);
      return;
    }
    const normalized = currentBody.toLocaleLowerCase().replace(/\s+/g, ' ').trim();
    void crypto.subtle.digest('SHA-256', new TextEncoder().encode(normalized))
      .then((bytes) => {
        if (active) setEditingChanged(Array.from(new Uint8Array(bytes)).map((b) => b.toString(16).padStart(2, '0')).join('') !== value.bodyHash);
      })
      .catch(() => { if (active) setEditingChanged(true); });
    return () => { active = false; };
  }, [currentBody, value?.bodyHash, value]);

  async function regenerate() {
    if (!letterId) return;
    setBusy(true);
    setError('');
    try {
      setNext(await apiPost('/agent/knowledge-drafts/' + letterId + '/regenerate', { requestKey: requestKey.current }, {timeout:180_000}));
    } catch (e) {
      setError(toErrorMessage(e, '重新生成没成功，原草稿还在'));
    } finally {
      setBusy(false);
    }
  }

  async function recheck() {
    if (!letterId) return;
    const submittedIdentity = editingIdentity;
    setAuditing(true);
    setError('');
    try {
      const result = await apiPost<{ mode: string; checks: FactCheck[]; bodyHash: string }>(
        '/agent/knowledge-drafts/' + letterId + '/recheck',
        { requestKey: createClientId(), bodyText: currentBody, subject: currentSubject },
        {timeout:120_000},
      );
      if (latestEditing.current === submittedIdentity) setAudit(result);
    } catch (e) {
      if (latestEditing.current === submittedIdentity) setError(toErrorMessage(e, '核对没成功，原草稿保留'));
    } finally {
      setAuditing(false);
    }
  }

  if (!value && !error) return null;

  const sourceLabel = (id: string) => {
    const website = value?.context.customerWebsites?.find((s) => s.sourceId === id);
    if (website) return '客户官网自述 · ' + website.url;
    const source = value?.sources.find((s) => s.sourceId === id);
    return source
      ? source.title + ' · v' + source.version
      : id === 'profile:' + value?.context.customerId
        ? '客户档案（不是我方政策）'
        : '未确认来源';
  };

  const answered = value?.questions.filter((q) => q.status === 'answered').length ?? 0;
  const pendingQuestions = value?.questions.filter((q) => q.status !== 'answered') ?? [];
  const sourceCount = value?.sources.length ?? 0;
  const claimCount = value?.claims.length ?? 0;
  const subjectChanged = currentSubject !== undefined && loaded.subject !== undefined && currentSubject !== loaded.subject;
  const bodyChanged = Boolean(loaded.reviewBodyChanged || editingChanged || subjectChanged);
  const freshnessChanged = Boolean(current?.changed.length);
  const freshnessFailed = Boolean(current?.failed);
  // 「请告诉我你们的起订量是？」这类问句不是承诺，不该混进「缺依据」清单里吓人
  const isQuestion = (text: string) => {
    const value = text.trim().replace(/["'”』】）)]+\$/g, '');
    if (value.endsWith('?')) return true;
    return /^(could|can|would|will|do|does|did|is|are|may|shall|should|what|when|which|how|please|let me know|i'?d like|we'?d like)\b/i.test(value);
  };
  const riskyChecks = (value?.factAudit?.checks ?? []).filter(
    (c) => (c.status === 'unsupported' || c.status === 'contradicted' || c.status === 'unverifiable') && !isQuestion(c.text),
  );
  const highRiskClaim = /\b(?:price|pricing|discount|free|sample|shipping|freight|payment|deposit|stock|exclusive|guarantee(?:d)?|certif(?:ied|icate)|legal|contract)\b|价格|报价|折扣|免费|样品|运费|付款|定金|库存|独家|保证|认证|合同|法律/i;
  const highRiskUnapproved = Boolean(value && !value.manualApprovedAt && highRiskClaim.test((value.claims ?? []).map((claim) => claim.text).join(' ')));
  const needsRegenerate = freshnessChanged || freshnessFailed || ['no_match', 'index_stale', 'index_not_ready', 'expired', 'conflict'].includes(value?.status ?? '');

  // 变化的依据去重：同一份资料反复出现时只留一行
  const changedReasons = (() => {
    const seen = new Set<string>();
    const rows: string[] = [];
    for (const item of current?.changed ?? []) {
      const reason = plainReason(item.reason);
      const key = `${item.title}|${reason}`;
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push(`${item.title}：${reason}`);
    }
    return rows;
  })();

  /** 待办清单：只列必须由人拍板的事 */
  const todos: Todo[] = [];
  if (highRiskUnapproved) {
    todos.push({
      key: 'high-risk',
      title: '这封涉及价格、交期或承诺',
      detail: '高风险内容需要你先点「审核通过」，系统才允许发送。',
    });
  }
  if (bodyChanged) {
    todos.push({
      key: 'body',
      title: '依据对的是改稿前的版本',
      detail: '你改过主题或正文，核对一下改的地方有没有动到数字和交期，没问题直接发。',
      action: letterId ? 'recheck' : undefined,
    });
  }
  if (freshnessChanged) {
    todos.push({
      key: 'sources',
      title: `${changedReasons.length} 条资料有变化`,
      bullets: changedReasons.slice(0, 3),
      detail: changedReasons.length > 3 ? `另有 ${changedReasons.length - 3} 条同类变化，展开下方明细可见` : undefined,
      action: letterId && needsRegenerate ? 'regenerate' : undefined,
    });
  }
  if (freshnessFailed) {
    todos.push({
      key: 'freshness',
      title: '暂时查不到资料状态',
      detail: '发送前请人工确认正文里的数字、交期和承诺。',
    });
  }
  if (riskyChecks.length > 0) {
    todos.push({
      key: 'claims',
      title: `${riskyChecks.length} 处说法没找到依据`,
      bullets: riskyChecks.slice(0, 3).map((check) => `信中这句「${clip(check.text)}」${checkStatusLabels[check.status]}`),
      detail: riskyChecks.length > 3 ? `另有 ${riskyChecks.length - 3} 处，展开下方明细可见` : '这类内容建议改掉，或先跟生产确认再发。',
    });
  }
  if (pendingQuestions.length > 0) {
    todos.push({
      key: 'questions',
      title: `${pendingQuestions.length} 个客户问题还没确认`,
      bullets: pendingQuestions.slice(0, 3).map((q) => questionLabels[q.question] ?? q.question),
      detail: pendingQuestions.length > 3 ? `另有 ${pendingQuestions.length - 3} 个` : '信里如果答了这些，先确认口径。',
    });
  }
  if (value && statusActions[value.status]) {
    todos.push({
      key: 'status',
      title: stateLabels[value.status] ?? '资料状态待确认',
      detail: statusActions[value.status],
      action: letterId && needsRegenerate ? 'regenerate' : undefined,
    });
  }
  if (value?.issues.some((i) => i.code === 'semantic_unverified' || i.code === 'draft_unverified') || value?.factAudit?.mode === 'unavailable') {
    todos.push({
      key: 'unverified',
      title: '这封稿子没做逐项核对',
      detail: '系统只保留了有依据的安全内容；发送前请确认，或重新生成。',
    });
  }
  if (value?.issues.some((i) => i.code === 'access_changed')) {
    todos.push({
      key: 'access',
      title: '部分历史依据现在无权查看',
      detail: '请管理员核对后再重新生成，当前稿不能直接发送。',
      action: letterId ? 'regenerate' : undefined,
    });
  }

  const clean = todos.length === 0;

  return (
    <section className="space-y-2.5" aria-label="发送前检查">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold">
          <ShieldCheck className="h-4 w-4 text-primary" aria-hidden />
          发送前检查
        </h3>
        {value ? (
          clean ? (
            <Badge variant="developed">
              <CheckCircle2 className="h-3 w-3" aria-hidden />
              可以发
            </Badge>
          ) : (
            <Badge variant="outline">{todos.length} 项要确认</Badge>
          )
        ) : null}
      </div>

      {error ? <p role="alert" className="text-sm leading-6 text-destructive">{error}</p> : null}

      {value ? (
        <>
          {clean ? (
            <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3 text-xs leading-5">
              <p className="flex items-center gap-1.5 font-medium text-emerald-700 dark:text-emerald-400">
                <CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden />
                检查通过
              </p>
              <p className="mt-1 text-muted-foreground">
                {sourceCount > 0
                  ? '收件人、正文里的数字和承诺都对得上已有资料，直接通过并发送就行。'
                  : '这封信没有引用我方政策，主要基于客户档案生成，确认收件人和称呼没问题即可。'}
              </p>
            </div>
          ) : (
            <ul className="space-y-2">
              {todos.map((todo) => (
                <li key={todo.key} className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-2.5 text-xs leading-5">
                  <p className="flex items-start gap-1.5 font-medium">
                    <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden />
                    <span className="flex-1">{todo.title}</span>
                  </p>
                  {todo.bullets?.length ? (
                    <ul className="mt-1.5 space-y-1 pl-5 text-muted-foreground">
                      {todo.bullets.map((line) => (
                        <li key={line} className="list-disc break-words">{line}</li>
                      ))}
                    </ul>
                  ) : null}
                  {todo.detail ? <p className="mt-1.5 pl-5 text-muted-foreground">{todo.detail}</p> : null}
                  {todo.action ? (
                    <div className="mt-2 pl-5">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-7 text-2xs"
                        disabled={auditing || busy || (todo.action === 'regenerate' && Boolean(next))}
                        onClick={() => void (todo.action === 'recheck' ? recheck() : regenerate())}
                      >
                        {auditing || busy
                          ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                          : todo.action === 'recheck'
                            ? <FileSearch className="h-3 w-3" aria-hidden />
                            : <RefreshCw className="h-3 w-3" aria-hidden />}
                        {todo.action === 'recheck' ? '核对当前修改' : '按最新依据重新生成'}
                      </Button>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}

          {audit ? (
            <div role="status" className="rounded-md border bg-muted/20 p-2.5 text-xs leading-5">
              <p className="font-medium">{audit.mode === 'semantic' ? '已按当前内容重新核对' : '语义核对没跑起来，请人工确认'}</p>
              <details className="mt-1">
                <summary className="min-h-9 cursor-pointer py-1 text-primary">看 {audit.checks.length} 项核对结果</summary>
                {audit.checks.map((check, index) => (
                  <div key={check.id + index} className="border-l pl-2.5">
                    <p className="break-words">{check.text}</p>
                    <p className="text-2xs text-muted-foreground">{checkStatusLabels[check.status]} · {check.reason}</p>
                  </div>
                ))}
              </details>
            </div>
          ) : null}

          <p className="text-2xs leading-5 text-muted-foreground">
            {sourceCount > 0
              ? `依据 ${sourceCount} 条资料 · 信里 ${claimCount} 项承诺`
              : stateLabels[value.status] ?? '待核对'}
            {value.generatedAt ? ` · 生成于 ${formatDateTime(value.generatedAt)}` : ''}
          </p>

          {next ? (
            <>
              <p role="status" className="rounded-md border border-primary/30 bg-primary/5 p-2 text-2xs leading-5 text-foreground">
                新稿已经生成，当前窗口打开的还是旧稿。旧稿上的“没找到可引用资料”或旧来源不代表新稿；请打开下面这份新草稿核对。
              </p>
              <Button asChild size="sm" className="w-full">
                <a href={'/customers/' + next.customerId + '?knowledgeDraft=' + next.letterId}>打开新生成的草稿</a>
              </Button>
            </>
          ) : null}

          <details className="group rounded-lg border bg-muted/20">
            <summary className="flex min-h-10 cursor-pointer list-none items-center gap-2 px-3 py-2 text-xs font-medium">
              <FileSearch className="h-3.5 w-3.5 shrink-0" aria-hidden />
              看依据明细
              <span className="ml-auto text-2xs font-normal text-muted-foreground">
                {sourceCount} 条资料 · {claimCount} 项承诺
              </span>
              <ChevronRight className="h-3.5 w-3.5 shrink-0 transition-transform group-open:rotate-90" aria-hidden />
            </summary>
            <div className="space-y-4 border-t px-3 py-3 text-xs leading-5">
              <p className="text-2xs text-muted-foreground">仅供内部核对，不会出现在发给客户的邮件里。</p>

              <section>
                <h4 className="font-semibold">用到的资料（{sourceCount}）</h4>
                {!value.sources.length ? (
                  <p className="mt-1.5 text-muted-foreground">这封信没有引用我方政策资料，主要基于客户档案。</p>
                ) : (
                  <ul className="mt-2 space-y-2">
                    {value.sources.map((source) => (
                      <li key={source.sourceId} className="rounded-md border bg-background p-2.5">
                        <p className="font-medium">{source.title} · v{source.version}</p>
                        <p className="mt-1 break-words text-2xs leading-5 text-muted-foreground">{source.source}</p>
                        <p className="mt-1.5 break-words">适用：{source.applicability}</p>
                        <details className="mt-1.5">
                          <summary className="min-h-9 cursor-pointer text-2xs text-primary">看用到的原文</summary>
                          <p className="whitespace-pre-wrap break-words text-2xs leading-5 text-muted-foreground">{source.content}</p>
                          <KnowledgeCitation source={source} letterId={letterId} />
                        </details>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section>
                <h4 className="font-semibold">信里的数字与承诺（{claimCount}）</h4>
                {!value.claims.length ? (
                  <p className="mt-1.5 text-muted-foreground">没有写具体数字或交期承诺。</p>
                ) : (
                  <ul className="mt-2 space-y-2">
                    {value.claims.map((claim, i) => (
                      <li key={i}>
                        <p className="break-words">{claim.text}</p>
                        <p className="mt-1 text-2xs leading-5 text-muted-foreground">{claim.sourceIds.map(sourceLabel).join('；')}</p>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section>
                <h4 className="font-semibold">客户关心的问题（{answered}/{value.questions.length} 已确认）</h4>
                {!value.questions.length ? (
                  <p className="mt-1.5 text-muted-foreground">这封邮件里没有提到具体政策问题。</p>
                ) : (
                  <ul className="mt-2 space-y-1.5">
                    {value.questions.map((q, i) => (
                      <li key={i} className="break-words">
                        <span className={q.status === 'answered' ? 'text-emerald-700 dark:text-emerald-400' : 'text-amber-700 dark:text-amber-400'}>
                          {q.status === 'answered' ? '已确认' : '待确认'} ·{' '}
                        </span>
                        {questionLabels[q.question] ?? q.question}
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              {value.factAudit ? (
                <section>
                  <h4 className="font-semibold">逐句核对（{value.factAudit.checks.length}）</h4>
                  <p className="mt-1 text-2xs leading-5 text-muted-foreground">
                    {value.factAudit.mode === 'semantic'
                      ? '已按语义逐句核对，交易承诺另核了数值和完整条件。'
                      : value.factAudit.mode === 'deterministic'
                        ? '只呈现已确认的条件记录，普通事实仍需人工看。'
                        : '语义核对没跑起来，逐句结论都需要人工确认'}核对不代表证书或协议已自动生效。
                  </p>
                  {value.factAudit.checks.length ? (
                    <ul className="mt-1 divide-y">
                      {value.factAudit.checks.map((check, i) => {
                        const quotes = check.quotes ?? [];
                        return (
                          <li key={check.id + i} className="space-y-1 py-2">
                            <p className="break-words">{check.text}</p>
                            <p
                              className={cn(
                                'text-2xs leading-5',
                                check.status === 'supported' || check.status === 'non_claim'
                                  ? 'text-emerald-700 dark:text-emerald-400'
                                  : 'text-amber-700 dark:text-amber-400',
                              )}
                            >
                              {checkStatusLabels[check.status]} · {check.reason}
                            </p>
                            {quotes.map((item, j) => {
                              const cited = value.sources.find((s) => s.sourceId === item.sourceId);
                              return (
                                <details key={j}>
                                  <summary className="min-h-9 cursor-pointer py-1 text-2xs text-primary">看引用的原话</summary>
                                  <p className="whitespace-pre-wrap break-words text-2xs leading-5 text-muted-foreground">{item.quote}</p>
                                  {cited ? <KnowledgeCitation source={cited} letterId={letterId} /> : null}
                                </details>
                              );
                            })}
                          </li>
                        );
                      })}
                    </ul>
                  ) : (
                    <p className="mt-1.5 text-2xs text-muted-foreground">没有需要逐句核对的承诺。</p>
                  )}

                  {value.factAudit.facts.length ? (
                    <details className="mt-1">
                      <summary className="min-h-9 cursor-pointer py-1 text-2xs text-primary">看条件适用性（{value.factAudit.facts.length}）</summary>
                      <ul className="mt-1 space-y-2">
                        {value.factAudit.facts.map((fact) => (
                          <li key={fact.id} className="border-l pl-2.5 text-2xs leading-5">
                            <p className="break-words">
                              {policyName(fact.topic)}：{fact.term.value} {fact.term.unit} {fact.term.currency}
                            </p>
                            <p className="break-words">{factStatusLabels[fact.status] ?? fact.status} · {fact.reasons.join('；')}</p>
                            <p className="text-muted-foreground">第 {fact.version} 版 · 条件 {fact.location.index + 1}</p>
                          </li>
                        ))}
                      </ul>
                    </details>
                  ) : null}
                </section>
              ) : null}

              {value.issues.length > 0 ? (
                <section>
                  <h4 className="font-semibold">缺口、过期与冲突（{value.issues.length}）</h4>
                  <ul className="mt-1.5 list-disc space-y-1.5 pl-4">
                    {value.issues.map((issue, i) => (
                      <li key={i} className="break-words text-muted-foreground">{issue.message}</li>
                    ))}
                  </ul>
                </section>
              ) : null}

              {letterId ? (
                <div className="flex flex-wrap gap-2 border-t pt-2">
                  <Button type="button" variant="ghost" size="sm" className="h-7 text-2xs" disabled={busy} onClick={() => void refreshEvidence()}>
                    {busy ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> : <RefreshCw className="h-3 w-3" aria-hidden />}
                    查一下资料有没有更新
                  </Button>
                  {needsRegenerate ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 text-2xs"
                      disabled={busy || Boolean(next)}
                      onClick={() => void regenerate()}
                    >
                      <RefreshCw className="h-3 w-3" aria-hidden />
                      按最新依据重新生成
                    </Button>
                  ) : null}
                </div>
              ) : null}
            </div>
          </details>
        </>
      ) : null}
    </section>
  );
}
