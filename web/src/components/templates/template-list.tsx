/**
 * 模板中心列表
 * ------------------------------------------------------------------
 * 卡片网格：每张卡展示分类 / 名称 / 主题 / 正文摘要 / 更新时间，
 * 并提供编辑、复制、删除三个动作。空态时给出「新建模板」入口。
 */
import * as React from 'react';
import { Copy, FilePlus2, Pencil, Sparkles, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState, ErrorState, InlineLoader, NoResultState } from '@/components/common/empty-state';
import { TEMPLATE_CATEGORY_LABEL } from '@/constants';
import { formatRelative, stripHtml } from '@/lib/format';
import type { LetterTemplate } from '@/types';

export interface TemplateListProps {
  templates: LetterTemplate[];
  loading: boolean;
  error: string | null;
  /** 是否有筛选条件（决定空态文案：没有模板 vs 没匹配到） */
  hasFilters: boolean;
  busy?: boolean;
  onRetry: () => void;
  onCreate: () => void;
  onEdit: (template: LetterTemplate) => void;
  onDuplicate: (template: LetterTemplate) => void;
  onSuggest: (template: LetterTemplate) => void;
  onDelete: (template: LetterTemplate) => void;
  onResetFilters: () => void;
}

export function TemplateList({
  templates,
  loading,
  error,
  hasFilters,
  busy = false,
  onRetry,
  onCreate,
  onEdit,
  onDuplicate,
  onSuggest,
  onDelete,
  onResetFilters,
}: TemplateListProps): React.JSX.Element {
  if (loading && templates.length === 0) {
    return <InlineLoader label="正在加载模板…" />;
  }

  if (error && templates.length === 0) {
    return <ErrorState title="模板加载失败" description={error} onRetry={onRetry} retrying={loading} />;
  }

  if (templates.length === 0) {
    return hasFilters ? (
      <NoResultState
        title="没有匹配的模板"
        description="试试调整关键词或切换分类"
        action={
          <Button type="button" size="sm" variant="outline" onClick={onResetFilters}>
            清空筛选
          </Button>
        }
      />
    ) : (
      <EmptyState
        title="还没有开发信模板"
        description="把常用的开发信存成模板，之后给客户发信时可一键带入主题与正文。"
        action={
          <Button type="button" size="sm" onClick={onCreate}>
            <FilePlus2 className="h-4 w-4" aria-hidden />
            新建模板
          </Button>
        }
      />
    );
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {templates.map((template) => (
        <article
          key={template.id}
          className="group flex flex-col rounded-lg border bg-card p-4 transition-colors hover:border-primary/40"
        >
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <Badge variant="outline" className="mb-1.5">
                {TEMPLATE_CATEGORY_LABEL[template.category] ?? template.category}
              </Badge>
              <h3 className="truncate text-sm font-semibold" title={template.name}>
                {template.name}
              </h3>
            </div>
          </div>

          <p className="mt-1.5 truncate text-xs text-muted-foreground" title={template.subject}>
            主题：{template.subject || '（无主题）'}
          </p>

          <p className="mt-2 line-clamp-3 flex-1 text-xs leading-relaxed text-muted-foreground">
            {stripHtml(template.content, 160) || '（无正文）'}
          </p>

          <div className="mt-3 flex items-center justify-between gap-2 border-t pt-3">
            <span className="text-2xs text-muted-foreground">更新于 {formatRelative(template.updatedAt)}</span>
            <div className="flex items-center gap-1">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                aria-label="编辑模板"
                title="编辑"
                disabled={busy}
                onClick={() => onEdit(template)}
              >
                <Pencil className="h-3.5 w-3.5" aria-hidden />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                aria-label="复制模板"
                title="复制"
                disabled={busy}
                onClick={() => onDuplicate(template)}
              >
                <Copy className="h-3.5 w-3.5" aria-hidden />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs"
                aria-label={`为${template.name}生成建议副本`}
                title="建议副本（需人工核对确认）"
                disabled={busy}
                onClick={() => onSuggest(template)}
              >
                <Sparkles className="h-3.5 w-3.5" aria-hidden />
                建议副本
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-muted-foreground hover:text-destructive"
                aria-label="删除模板"
                title="删除"
                disabled={busy}
                onClick={() => onDelete(template)}
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden />
              </Button>
            </div>
          </div>
        </article>
      ))}
    </div>
  );
}
