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
import { usePageTitle } from '@/hooks/use-ui';
import { useTemplateStore } from '@/store/template.store';
import { TEMPLATE_CATEGORY_FILTER_OPTIONS } from '@/constants';
import type { LetterTemplate, TemplateCategory } from '@/types';

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

  // 进入页面时拉取一次全量模板
  React.useEffect(() => {
    void fetchList();
  }, [fetchList]);

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
          onDelete={setDeleteTarget}
          onResetFilters={resetFilters}
        />
      </Card>

      {/* ---------------------------- 弹窗 ---------------------------- */}

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
