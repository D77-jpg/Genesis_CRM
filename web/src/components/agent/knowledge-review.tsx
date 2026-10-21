import { KnowledgeCitation } from './knowledge-citation';
import * as React from 'react';
import {
  ChevronRight,
  FileSearch,
  Loader2,
  RefreshCw,
  ShieldCheck,
  TriangleAlert,
  Wrench,
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

const stateLabels: Record<string, string> = {
  index_not_ready: '检索资料尚未就绪',
  index_stale: '检索资料需要更新',
  ready: '已检索有效知识',
  no_match: '没有匹配的有效知识',
  expired: '相关知识已过期',
  conflict: '存在来源冲突',
  retrieval_failed: '检索暂时失败',
};

const statusActions: Record<string, string> = {
  index_not_ready: '请管理员进入「知识库 → 检索准备」，准备资料后重新生成。',
  index_stale: '请管理员更新检索资料，再按最新依据重新生成。',
  no_match: '请缩小产品或问题范围，或请管理员补充并发布相关知识。',
  expired: '请业务负责人确认新政策，更新有效期后重新生成。',
  conflict: '请业务负责人核对冲突来源，确认前不要对外承诺。',
  retrieval_failed: '请稍后重试；当前草稿只保留有依据的部分。',
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

function Stat({ label, value, tone = 'default' }: { label: string; value: number; tone?: 'default' | 'warning' }) {
  return (
    <div className="rounded-md border bg-background px-2.5 py-2">
      <dt className="text-2xs text-muted-foreground">{label}</dt>
      <dd className={tone === 'warning' && value > 0 ? 'text-base font-semibold text-amber-700 dark:text-amber-400' : 'text-base font-semibold tabular-nums'}>
        {value}
      </dd>
    </div>
  );
}

/**
 * 草稿依据与风险面板。
 * 只保留审核时真正需要决策的信息：结论、风险、依据数量；
 * 详细来源、问题与复核明细收进可展开区域，避免在审核弹窗里堆成一堵墙。
 */
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
      .catch((e) => { if (active) setError(toErrorMessage(e, '无法读取草稿依据，请稍后重试')); });
    return () => { active = false; };
  }, [letterId, analysisId]);

  async function refreshEvidence() {
    if (!letterId) return;
    setBusy(true);
    setError('');
    try {
      setLoaded(await apiGet<EvidenceResult>('/letters/' + letterId));
    } catch (e) {
      setError(toErrorMessage(e, '暂时无法核对资料状态，请稍后重试'));
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
      setNext(await apiPost('/agent/knowledge-drafts/' + letterId + '/regenerate', { requestKey: requestKey.current }));
    } catch (e) {
      setError(toErrorMessage(e, '重新生成尚未完成，原草稿仍保留'));
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
      );
      if (latestEditing.current === submittedIdentity) setAudit(result);
    } catch (e) {
      if (latestEditing.current === submittedIdentity) setError(toErrorMessage(e, '复核尚未完成，原草稿保留'));
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
  const pending = value?.questions.filter((q) => q.status !== 'answered').length ?? 0;
  const sourceCount = value?.sources.length ?? 0;
  const subjectChanged = currentSubject !== undefined && loaded.subject !== undefined && currentSubject !== loaded.subject;
  const bodyChanged = Boolean(loaded.reviewBodyChanged || editingChanged || subjectChanged);
  const freshnessChanged = Boolean(current?.changed.length);
  const freshnessFailed = Boolean(current?.failed);
  const needsAttention = value?.completeness === 'partial' || freshnessChanged || freshnessFailed;
  const needsRegenerate = freshnessChanged || freshnessFailed || ['no_match', 'index_stale', 'index_not_ready', 'expired', 'conflict'].includes(value?.status ?? '');
  const riskyChecks = value?.factAudit?.checks.filter((c) => c.status === 'unsupported' || c.status === 'contradicted' || c.status === 'unverifiable').length ?? 0;

  return (
    <section className="space-y-3" aria-label="草稿知识依据">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold">
          <ShieldCheck className="h-4 w-4 text-primary" aria-hidden />
          依据与风险
        </h3>
        {value ? (
          <Badge variant={needsAttention ? 'outline' : 'developed'}>
            {needsAttention ? '有需要确认的内容' : '依据已核对'}
          </Badge>
        ) : null}
      </div>

      {freshnessFailed ? (
        <div role="status" className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-xs leading-5">
          <p className="flex items-center gap-1.5 font-medium"><TriangleAlert className="h-3.5 w-3.5 shrink-0" aria-hidden />暂时无法核对依据状态</p>
          <p className="mt-1 text-muted-foreground">发送前请人工核对正文中的数字、交期和承诺。</p>
        </div>
      ) : null}

      {freshnessChanged ? (
        <div role="status" className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-xs leading-5">
          <p className="flex items-center gap-1.5 font-medium"><TriangleAlert className="h-3.5 w-3.5 shrink-0" aria-hidden />草稿使用的依据已发生变化</p>
          <p className="mt-1 text-muted-foreground">原草稿保留生成时的内容与依据，发送前请重新核对。</p>
          {current?.changed.map((item) => <p key={item.sourceId} className="mt-1 break-words">{item.title}：{item.reason}</p>)}
        </div>
      ) : null}

      {bodyChanged ? (
        <p className="flex items-start gap-1.5 rounded-md bg-amber-500/10 px-2.5 py-2 text-xs leading-5 text-amber-800 dark:text-amber-300">
          <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          主题或正文已修改，依据对应的是原生成版本，请核对修改后的承诺。
        </p>
      ) : null}

      {error ? <p role="alert" className="text-sm leading-6 text-destructive">{error}</p> : null}

      {value ? (
        <>
          {sourceCount > 0 ? (
            value.questions.length > 0 ? (
              <dl className="grid grid-cols-3 gap-2">
                <Stat label="已确认" value={answered} />
                <Stat label="待确认" value={pending} tone="warning" />
                <Stat label="引用依据" value={sourceCount} />
              </dl>
            ) : (
              <dl className="grid grid-cols-2 gap-2">
                <Stat label="承诺数" value={value.claims.length} />
                <Stat label="引用依据" value={sourceCount} />
              </dl>
            )
          ) : (
            <div className="rounded-lg border border-dashed bg-muted/30 p-3">
              <p className="text-xs font-medium">没有匹配到可引用的已发布资料</p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">当前草稿主要基于客户档案生成。发送前请人工核对数字、交期和承诺，不要直接采信模型表述。</p>
            </div>
          )}

          <p className="text-2xs leading-5 text-muted-foreground">
            {stateLabels[value.status] ?? '待核对'} · 生成于 {formatDateTime(value.generatedAt)}
          </p>

          {riskyChecks > 0 ? (
            <p role="status" className="flex items-start gap-1.5 rounded-md border border-amber-500/30 bg-amber-500/5 px-2.5 py-2 text-xs leading-5">
              <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
              <span>
                有 <strong className="font-medium">{riskyChecks}</strong> 条承诺缺少依据或需人工确认，发送前请逐条核对（详见「查看内部审核信息」）。
              </span>
            </p>
          ) : null}

          {statusActions[value.status] ? (
            <p className="rounded-md border border-amber-500/30 bg-amber-500/5 px-2.5 py-2 text-xs leading-5">
              <span className="font-medium">下一步：</span>{statusActions[value.status]}
            </p>
          ) : null}

          {value.issues.some((i) => i.code === 'draft_unverified') ? (
            <p role="status" className="rounded-md border border-amber-300 bg-amber-50 px-2.5 py-2 text-xs leading-5 text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200">
              本稿未完成逐项核验，发送前请对照依据核对数字、条件和承诺。
            </p>
          ) : null}

          <details className="group rounded-lg border bg-muted/20">
            <summary className="flex min-h-10 cursor-pointer list-none items-center gap-2 px-3 py-2 text-xs font-medium">
              <FileSearch className="h-3.5 w-3.5 shrink-0" aria-hidden />
              查看内部审核信息
              <span className="ml-auto text-2xs font-normal text-muted-foreground">
                {value.claims.length} 项承诺 · {value.questions.length} 个问题
              </span>
              <ChevronRight className="h-3.5 w-3.5 shrink-0 transition-transform group-open:rotate-90" aria-hidden />
            </summary>
            <div className="space-y-4 border-t px-3 py-3 text-xs leading-5">
              <p className="text-2xs text-muted-foreground">仅供内部审核，不会自动写入客户邮件。</p>

              <section>
                <h4 className="font-semibold">使用的知识与版本</h4>
                {!value.sources.length ? (
                  <p className="mt-1.5 text-muted-foreground">尚无可用依据，请补充资料后重新生成。</p>
                ) : (
                  <ul className="mt-2 space-y-2">
                    {value.sources.map((source) => (
                      <li key={source.sourceId} className="rounded-md border bg-background p-2.5">
                        <p className="font-medium">{source.title} · v{source.version}</p>
                        <p className="mt-1 break-words text-2xs leading-5 text-muted-foreground">{source.source}</p>
                        <p className="mt-1.5 break-words">适用：{source.applicability}</p>
                        <details className="mt-1.5">
                          <summary className="min-h-9 cursor-pointer text-2xs text-primary">查看生成时的相关片段</summary>
                          <p className="whitespace-pre-wrap break-words text-2xs leading-5 text-muted-foreground">{source.content}</p>
                          <KnowledgeCitation source={source} letterId={letterId} />
                        </details>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section>
                <h4 className="font-semibold">关键承诺与依据</h4>
                {!value.claims.length ? (
                  <p className="mt-1.5 text-muted-foreground">未加入数值型交易承诺。</p>
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
                <h4 className="font-semibold">客户问题</h4>
                {!value.questions.length ? (
                  <p className="mt-1.5 text-muted-foreground">本次没有提取到具体政策问题。</p>
                ) : (
                  <ul className="mt-2 space-y-1.5">
                    {value.questions.map((q, i) => (
                      <li key={i} className="break-words">
                        <span className={q.status === 'answered' ? 'text-emerald-700 dark:text-emerald-400' : 'text-amber-700 dark:text-amber-400'}>
                          {q.status === 'answered' ? '已回答' : '待确认'} ·{' '}
                        </span>
                        {questionLabels[q.question] ?? q.question}
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              {value.factAudit ? (
                <section>
                  <h4 className="font-semibold">逐项事实核对（{value.factAudit.checks.length}）</h4>
                  <p className="mt-1 text-2xs leading-5 text-muted-foreground">
                    {value.factAudit.mode === 'semantic'
                      ? '已做语义核对，交易承诺另核数值与完整条件'
                      : value.factAudit.mode === 'deterministic'
                        ? '仅呈现已确认的条件记录，普通事实待审'
                        : '语义核验未完成，逐项结论均需人工核对'}。核对不代表证书真实性或协议效力已自动确认。
                  </p>
                  {value.factAudit.checks.length ? (
                    <ul className="mt-1 divide-y">
                      {value.factAudit.checks.map((check, i) => {
                        const quote = check.quotes ?? [];
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
                            {quote.map((item, j) => {
                              const cited = value.sources.find((s) => s.sourceId === item.sourceId);
                              return (
                                <details key={j}>
                                  <summary className="min-h-9 cursor-pointer py-1 text-2xs text-primary">查看精确引用</summary>
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
                    <p className="mt-1.5 text-2xs text-muted-foreground">未提取到需要逐项核对的承诺。</p>
                  )}

                  {value.factAudit.facts.length ? (
                    <details className="mt-1">
                      <summary className="min-h-9 cursor-pointer py-1 text-2xs text-primary">查看条件适用性（{value.factAudit.facts.length}）</summary>
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
                  <h4 className="font-semibold">缺口、过期与冲突</h4>
                  <ul className="mt-1.5 list-disc space-y-1.5 pl-4">
                    {value.issues.map((issue, i) => <li key={i} className="break-words text-muted-foreground">{issue.message}</li>)}
                  </ul>
                </section>
              ) : null}
            </div>
          </details>

          {bodyChanged && letterId ? (
            <Button type="button" variant="outline" size="sm" className="w-full" disabled={auditing} onClick={() => void recheck()}>
              {auditing ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <FileSearch className="h-3.5 w-3.5" aria-hidden />}
              核对当前修改
            </Button>
          ) : null}

          {letterId ? (
            <details className="group rounded-lg border">
              <summary className="flex min-h-10 cursor-pointer list-none items-center gap-2 px-3 py-2 text-xs font-medium">
                <Wrench className="h-3.5 w-3.5 shrink-0" aria-hidden />
                核对工具
                <ChevronRight className="ml-auto h-3.5 w-3.5 shrink-0 transition-transform group-open:rotate-90" aria-hidden />
              </summary>
              <div className="space-y-2 border-t px-3 py-3">
                <Button type="button" variant="outline" size="sm" className="w-full" disabled={auditing} onClick={() => void recheck()}>
                  {auditing ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <FileSearch className="h-3.5 w-3.5" aria-hidden />}
                  核对当前编辑内容
                </Button>
                <p className="text-2xs leading-5 text-muted-foreground">核对当前主题与正文，保留原稿和原生成依据。继续修改后需重新核对。</p>

                {audit ? (
                  <div role="status" className="space-y-2 rounded-md border bg-background p-2.5 text-xs leading-5">
                    <p className="font-medium">{audit.mode === 'semantic' ? '本次逐项核对结果' : '语义核验未完成，请人工确认'}</p>
                    <details>
                      <summary className="min-h-9 cursor-pointer py-1 text-primary">查看 {audit.checks.length} 项复核明细</summary>
                      {audit.checks.map((c, i) => (
                        <div key={c.id + i} className="border-l pl-2.5">
                          <p className="break-words">{c.text}</p>
                          <p className="text-2xs text-muted-foreground">{checkStatusLabels[c.status]} · {c.reason}</p>
                        </div>
                      ))}
                    </details>
                  </div>
                ) : null}

                <div className="flex flex-col gap-2 border-t pt-2">
                  <Button type="button" variant="ghost" size="sm" className="justify-start" disabled={busy} onClick={() => void refreshEvidence()}>
                    {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <RefreshCw className="h-3.5 w-3.5" aria-hidden />}
                    核对资料是否更新
                  </Button>
                  {needsRegenerate ? (
                    <Button type="button" variant="outline" size="sm" className="justify-start" disabled={busy || Boolean(next)} onClick={() => void regenerate()}>
                      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <RefreshCw className="h-3.5 w-3.5" aria-hidden />}
                      按最新依据重新生成
                    </Button>
                  ) : null}
                  {next ? (
                    <Button asChild size="sm" className="w-full">
                      <a href={'/customers/' + next.customerId + '?knowledgeDraft=' + next.letterId}>打开新草稿审核</a>
                    </Button>
                  ) : null}
                  {needsRegenerate && !next ? (
                    <p className="text-2xs leading-5 text-muted-foreground">生成新草稿，保留当前版本。</p>
                  ) : null}
                </div>
              </div>
            </details>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
