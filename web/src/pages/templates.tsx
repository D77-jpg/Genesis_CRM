/**
 * 开发信模板中心
 * ------------------------------------------------------------------
 * 集中管理可复用的开发信模板：新建 / 编辑 / 删除 / 复制，按分类与关键词筛选。
 * 「使用模板创建开发信」在客户详情的发送弹窗里完成（一键带入主题与正文），
 * 本页只负责模板本身的维护。
 */
import * as React from 'react';
import { toast } from 'sonner';
import { FilePlus2, FilterX } from 'lucide-react';
import { PageHeader } from '@/components/common/page-header';
import { SearchInput } from '@/components/common/search-input';
import { ConfirmDialog } from '@/components/common/confirm-dialog';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { TemplateList } from '@/components/templates/template-list';
import { TemplateFormDialog } from '@/components/templates/template-form-dialog';
import { TemplateSuggestionDialog } from '@/components/templates/template-suggestion-dialog';
import { apiGet, toErrorMessage } from '@/lib/api';
import { useProjectStore } from '@/store/project.store';
import { usePageTitle } from '@/hooks/use-ui';
import { useTemplateStore } from '@/store/template.store';
import { TEMPLATE_CATEGORY_FILTER_OPTIONS } from '@/constants';
import type { LetterTemplate, TemplateCategory, TemplatePerformanceStage, TemplatePerformanceSummary } from '@/types';

const STAGES: { key: TemplatePerformanceStage; label: string }[] = [
  { key: 'replied', label: '回复' }, { key: 'interested', label: '意向' },
  { key: 'quoted', label: '报价' }, { key: 'won', label: '成交' },
  { key: 'unsubscribed', label: '退订' }, { key: 'bounced', label: '退信' },
];

/** Select 的「不限」值（Radix 不接受空字符串） */
const ALL = 'all';

export function TemplatesPage(): React.JSX.Element {
  usePageTitle('模板中心');

  const items = useTemplateStore((state) => state.items);
  const loading = useTemplateStore((state) => state.loading);
  const mutating = useTemplateStore((state) => state.mutating);
  const error = useTemplateStore((state) => state.error);
  const category = useTemplateStore((state) => state.category);
  const keyword = useTemplateStore((state) => state.keyword);
  const setFilters = useTemplateStore((state) => state.setFilters);
  const resetFilters = useTemplateStore((state) => state.resetFilters);
  const visibleItems = useTemplateStore((state) => state.visibleItems);
  const fetchList = useTemplateStore((state) => state.fetchList);
  const duplicateTemplate = useTemplateStore((state) => state.duplicateTemplate);
  const deleteTemplate = useTemplateStore((state) => state.deleteTemplate);

  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [editTarget, setEditTarget] = React.useState<LetterTemplate | null>(null);
  const [deleteTarget, setDeleteTarget] = React.useState<LetterTemplate | null>(null);
  const [suggestTarget, setSuggestTarget] = React.useState<LetterTemplate | null>(null);
  const projectId = useProjectStore((state) => state.activeProject?.id);
  const [windowDays, setWindowDays] = React.useState<30 | 90 | 180>(30);
  const [performance, setPerformance] = React.useState<TemplatePerformanceSummary | null>(null);
  const [performanceError, setPerformanceError] = React.useState<string | null>(null);
  const [performanceLoading, setPerformanceLoading] = React.useState(false);
  const [refreshVersion, setRefreshVersion] = React.useState(0);

  React.useEffect(() => {
    setSuggestTarget(null);
    setPerformance(null);
    if (projectId) void fetchList();
  }, [fetchList, projectId]);

  React.useEffect(() => {
    if (!projectId) return;
    let active = true;
    setPerformance(null);
    setPerformanceError(null);
    setPerformanceLoading(true);
    void apiGet<TemplatePerformanceSummary>(`/templates/performance?windowDays=${windowDays}`)
      .then((response) => { if (active) setPerformance(response); })
      .catch((caught: unknown) => { if (active) setPerformanceError(toErrorMessage(caught, '模板效果加载失败')); })
      .finally(() => { if (active) setPerformanceLoading(false); });
    return () => { active = false; };
  }, [projectId, windowDays, refreshVersion]);

  const templates = React.useMemo(() => visibleItems(), [visibleItems, items, category, keyword]);
  const hasFilters = category !== ALL || keyword.trim() !== '';

  const openCreate = React.useCallback(() => {
    setEditTarget(null);
    setDialogOpen(true);
  }, []);

  const openEdit = React.useCallback((template: LetterTemplate) => {
    setEditTarget(template);
    setDialogOpen(true);
  }, []);

  const handleDuplicate = React.useCallback(
    async (template: LetterTemplate) => {
      try {
        const copy = await duplicateTemplate(template.id);
        if (copy) toast.success('模板已复制', { description: copy.name });
      } catch (caught) {
        toast.error('复制失败', { description: caught instanceof Error ? caught.message : String(caught) });
      }
    },
    [duplicateTemplate],
  );

  const confirmDelete = React.useCallback(async () => {
    if (!deleteTarget) return;
    try {
      await deleteTemplate(deleteTarget.id);
      toast.success('模板已删除', { description: deleteTarget.name });
      setDeleteTarget(null);
    } catch (caught) {
      toast.error('删除失败', { description: caught instanceof Error ? caught.message : String(caught) });
    }
  }, [deleteTarget, deleteTemplate]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="模板中心"
        description={
          items.length > 0 ? (
            <>
              共 <span className="font-medium text-foreground tabular-nums">{items.length}</span> 个模板
              {hasFilters ? `，当前显示 ${templates.length} 个` : ''}
            </>
          ) : (
            '把常用的开发信存成模板，发信时一键带入主题与正文，占位符照常可用'
          )
        }
        actions={
          <>
            {hasFilters ? (
              <Button type="button" variant="ghost" size="sm" onClick={resetFilters}>
                <FilterX className="h-4 w-4" aria-hidden />
                清空筛选
              </Button>
            ) : null}
            <Button type="button" size="sm" onClick={openCreate}>
              <FilePlus2 className="h-4 w-4" aria-hidden />
              新建模板
            </Button>
          </>
        }
      />

      {/* ---------------------------- 筛选栏 ---------------------------- */}

      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <SearchInput
          value={keyword}
          onChange={(value) => setFilters({ keyword: value })}
          placeholder="搜索模板名称 / 主题…"
          className="w-full sm:w-64 lg:w-72"
          aria-label="搜索模板"
        />

        <Select value={category} onValueChange={(value) => setFilters({ category: value as TemplateCategory | 'all' })}>
          <SelectTrigger className="h-8 w-auto min-w-[8rem] max-w-[12rem] text-xs" aria-label="模板分类">
            <SelectValue placeholder="全部分类" />
          </SelectTrigger>
          <SelectContent>
            {TEMPLATE_CATEGORY_FILTER_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value} className="text-xs">
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Card className="space-y-4 p-4" aria-label="模板效果">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div><h2 className="font-semibold">模板效果</h2><p className="text-xs text-muted-foreground">按发送窗口汇总同项目客户的关联事件；发送数为信件数，样本数为去重收件客户数。</p></div>
          <Select value={String(windowDays)} onValueChange={(value) => setWindowDays(Number(value) as 30 | 90 | 180)}>
            <SelectTrigger className="w-32" aria-label="统计窗口"><SelectValue /></SelectTrigger>
            <SelectContent>{([30, 90, 180] as const).map((days) => <SelectItem key={days} value={String(days)}>近 {days} 天</SelectItem>)}</SelectContent>
          </Select>
        </div>
        {performanceLoading ? <p role="status">正在加载效果统计…</p> : null}
        {performanceError ? <div role="alert" className="text-sm text-destructive">{performanceError} <Button type="button" variant="outline" size="sm" onClick={() => setRefreshVersion((value) => value + 1)}>重试</Button></div> : null}
        {performance ? <>
          <p className="text-xs text-muted-foreground">窗口：{new Date(performance.windowStart).toLocaleDateString()}—{new Date(performance.windowEnd).toLocaleDateString()} · 低样本门槛：{performance.sampleThreshold} 位客户 · 未归因发送：{performance.unattributed} 封（不猜测模板归属）。</p>
          <p className="rounded-md border bg-muted/40 p-2 text-xs">非因果提示：{performance.correlationDisclaimer}</p>
          {performance.templates.length === 0 ? <p className="text-sm text-muted-foreground">此窗口暂无已归因的发送记录。</p> : <div className="space-y-3">
            <p className="text-xs text-muted-foreground">按模板 ID 稳定展示，不按转化率排名；低样本不参与排名或效果优劣判断。同一模板的不同内容快照分开展示。</p>
            {performance.templates.map((entry) => <div key={JSON.stringify([entry.templateId, entry.templateNameSnapshot, entry.templateContentHash])} className="space-y-2 rounded-md border p-3 text-sm">
              <div className="flex flex-wrap items-center gap-2"><strong>{entry.templateNameSnapshot || '（旧记录无名称快照）'}</strong>{entry.deleted ? <span className="rounded bg-muted px-2 py-0.5 text-xs">已删除模板 · 历史快照</span> : null}{entry.insufficientSample ? <span className="text-xs text-amber-700">低样本，不排名</span> : null}</div>
              <p className="break-all text-xs text-muted-foreground">模板 ID：{entry.templateId} · 内容快照 SHA-256：{entry.templateContentHash || '旧记录未保留'}</p>
              <p>发送 {entry.metrics.sent} 封 · 样本 {entry.sampleSize} 位去重客户{entry.insufficientSample ? `（未达 ${performance.sampleThreshold}）` : ''}</p>
              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">{STAGES.map(({ key, label }) => {
                const rate = entry.rates[key];
                return <p key={key} className="rounded bg-muted/30 p-2 text-xs">{label}：{entry.metrics[key]} 位 · {rate.numerator}/{rate.denominator}（{rate.rate === null ? '无分母' : `${(rate.rate * 100).toFixed(1)}%`}）{entry.insufficientSample ? ' · 仅展示不排名' : ''}</p>;
              })}</div>
            </div>)}</div>}
        </> : null}
      </Card>

      {/* ---------------------------- 模板卡片 ---------------------------- */}

      <Card className="p-4">
        <TemplateList
          templates={templates}
          loading={loading}
          error={error}
          hasFilters={hasFilters}
          busy={mutating}
          onRetry={() => void fetchList()}
          onCreate={openCreate}
          onEdit={openEdit}
          onDuplicate={(template) => void handleDuplicate(template)}
          onSuggest={setSuggestTarget}
          onDelete={setDeleteTarget}
          onResetFilters={resetFilters}
        />
      </Card>

      {/* ---------------------------- 弹窗 ---------------------------- */}

      <TemplateSuggestionDialog
        template={suggestTarget}
        onClose={() => setSuggestTarget(null)}
        onCopied={async () => { await fetchList(); setRefreshVersion((value) => value + 1); }}
      />

      <TemplateFormDialog
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) setEditTarget(null);
        }}
        template={editTarget}
      />

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="删除模板"
        description={
          deleteTarget
            ? `确定要删除模板「${deleteTarget.name}」吗？删除后无法恢复，已用该模板发送过的开发信不受影响。`
            : undefined
        }
        confirmText="删除"
        variant="destructive"
        loading={mutating}
        onConfirm={confirmDelete}
      />
    </div>
  );
}
