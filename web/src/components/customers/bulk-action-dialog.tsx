/**
 * 批量操作弹窗
 * ------------------------------------------------------------------
 * 承载「添加 / 删除标签、分配负责人、设置下一次跟进时间」四类批量动作。
 * 每类都在真正提交前展示将影响的客户数量并二次确认，满足「操作前确认」的要求。
 * 标签沿用与客户表单一致的「逗号分隔文本」输入，配合已有标签词汇表做 datalist 提示，
 * 不引入新的编辑器；负责人 / 跟进时间复用现有 Select 与 date input。
 */
import * as React from 'react';
import { CalendarClock, Tag, UserRound } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { parseTagsText } from '@/lib/validators';
import type { OwnerOption } from '@/types';

/** 四类批量动作 */
export type BulkActionKind = 'addTags' | 'removeTags' | 'assignOwner' | 'setFollowUp';

/** 提交给页面的载荷：不同动作只填对应字段 */
export interface BulkActionPayload {
  tags?: string[];
  ownerId?: string | null;
  nextFollowUpAt?: string | null;
}

/** 负责人 Select 里表示「清除 / 未分配」的哨兵值（Radix 不允许 value=""） */
const OWNER_NONE = '__none__';

const TITLE: Record<BulkActionKind, string> = {
  addTags: '批量添加标签',
  removeTags: '批量删除标签',
  assignOwner: '批量分配负责人',
  setFollowUp: '批量设置跟进时间',
};

const TITLE_ICON: Record<BulkActionKind, React.ReactNode> = {
  addTags: <Tag className="h-4 w-4 text-primary" aria-hidden />,
  removeTags: <Tag className="h-4 w-4 text-primary" aria-hidden />,
  assignOwner: <UserRound className="h-4 w-4 text-primary" aria-hidden />,
  setFollowUp: <CalendarClock className="h-4 w-4 text-primary" aria-hidden />,
};

export interface BulkActionDialogProps {
  open: boolean;
  /** 当前动作；null 时不渲染 */
  kind: BulkActionKind | null;
  /** 已选客户数量，用于确认文案 */
  selectedCount: number;
  /** 已有标签词汇表（datalist 提示） */
  tags: string[];
  /** 负责人候选 */
  owners: OwnerOption[];
  busy?: boolean;
  onOpenChange: (open: boolean) => void;
  /** 在弹窗内切换「添加 / 删除标签」 */
  onKindChange?: (kind: BulkActionKind) => void;
  onConfirm: (kind: BulkActionKind, payload: BulkActionPayload) => void | Promise<void>;
}

export function BulkActionDialog({
  open,
  kind,
  selectedCount,
  tags,
  owners,
  busy = false,
  onOpenChange,
  onKindChange,
  onConfirm,
}: BulkActionDialogProps): React.JSX.Element | null {
  const [tagsText, setTagsText] = React.useState('');
  const [ownerId, setOwnerId] = React.useState<string>(OWNER_NONE);
  const [date, setDate] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);

  // 每次打开或切换动作时重置输入，避免上一次的值残留
  React.useEffect(() => {
    if (open) {
      setTagsText('');
      setOwnerId(OWNER_NONE);
      setDate('');
      setError(null);
    }
  }, [open, kind]);

  if (!kind) return null;

  const isTags = kind === 'addTags' || kind === 'removeTags';
  const parsedTags = parseTagsText(tagsText);

  const canSubmit = isTags
    ? parsedTags.length > 0
    : kind === 'assignOwner'
      ? true // 「未分配」也是合法选择（清除负责人）
      : date.trim() !== '';

  const description =
    kind === 'addTags'
      ? `为已选的 ${selectedCount} 位客户添加标签，已存在的标签会自动跳过。`
      : kind === 'removeTags'
        ? `从已选的 ${selectedCount} 位客户身上移除指定标签，没有该标签的客户不受影响。`
        : kind === 'assignOwner'
          ? `将已选的 ${selectedCount} 位客户分配给同一位负责人。`
          : `为已选的 ${selectedCount} 位客户设置下一次跟进时间。`;

  const confirmLabel =
    kind === 'addTags' ? '确认添加' : kind === 'removeTags' ? '确认删除' : '确认';

  const handleConfirm = (): void => {
    if (isTags) {
      if (parsedTags.length === 0) {
        setError('请至少输入一个标签');
        return;
      }
      void onConfirm(kind, { tags: parsedTags });
      return;
    }
    if (kind === 'assignOwner') {
      void onConfirm(kind, { ownerId: ownerId === OWNER_NONE ? null : ownerId });
      return;
    }
    if (!date.trim()) {
      setError('请选择一个日期');
      return;
    }
    void onConfirm(kind, { nextFollowUpAt: date.trim() });
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {TITLE_ICON[kind]}
            {TITLE[kind]}
          </DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-1">
          {isTags ? (
            <>
              {/* 添加 / 删除 模式切换：同一弹窗内直接切换，无需关闭重开 */}
              <div className="inline-flex rounded-md border p-0.5" role="tablist" aria-label="标签操作类型">
                {(['addTags', 'removeTags'] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    role="tab"
                    aria-selected={kind === mode}
                    disabled={busy}
                    onClick={() => onKindChange?.(mode)}
                    className={cn(
                      'rounded px-3 py-1 text-xs font-medium transition-colors',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                      kind === mode ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted',
                      busy && 'cursor-not-allowed opacity-60',
                    )}
                  >
                    {mode === 'addTags' ? '添加标签' : '删除标签'}
                  </button>
                ))}
              </div>

              <div>
                <Label htmlFor="bulk-tags">标签</Label>
                <Input
                  id="bulk-tags"
                  value={tagsText}
                  onChange={(event) => {
                    setTagsText(event.target.value);
                    setError(null);
                  }}
                  placeholder="多个标签用逗号分隔，例如：珠宝, 高优先级"
                  list="bulk-tags-options"
                  autoComplete="off"
                  disabled={busy}
                  className="mt-1.5"
                />
                <datalist id="bulk-tags-options">
                  {tags.map((tag) => (
                    <option key={tag} value={tag} />
                  ))}
                </datalist>
                <p className="mt-1 text-xs text-muted-foreground">
                  {parsedTags.length > 0
                    ? `将操作 ${parsedTags.length} 个标签：${parsedTags.join('、')}`
                    : '至少输入一个标签，可从下拉中选择已有标签'}
                </p>
              </div>
            </>
          ) : null}

          {kind === 'assignOwner' ? (
            <div>
              <Label htmlFor="bulk-owner">负责人</Label>
              <Select
                value={ownerId}
                onValueChange={(value) => {
                  setOwnerId(value);
                  setError(null);
                }}
                disabled={busy}
              >
                <SelectTrigger id="bulk-owner" className="mt-1.5">
                  <SelectValue placeholder="选择负责人" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={OWNER_NONE}>未分配（清除负责人）</SelectItem>
                  {owners.map((owner) => (
                    <SelectItem key={owner.id} value={owner.id}>
                      {owner.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {owners.length === 0 ? (
                <p className="mt-1 text-xs text-muted-foreground">当前没有可分配的负责人。</p>
              ) : null}
            </div>
          ) : null}

          {kind === 'setFollowUp' ? (
            <div>
              <Label htmlFor="bulk-followup">下一次跟进时间</Label>
              <Input
                id="bulk-followup"
                type="date"
                value={date}
                onChange={(event) => {
                  setDate(event.target.value);
                  setError(null);
                }}
                disabled={busy}
                className="mt-1.5"
              />
              <p className="mt-1 text-xs text-muted-foreground">所选客户都会被设置为同一个跟进日期。</p>
            </div>
          ) : null}

          {error ? <p className="text-xs text-destructive">{error}</p> : null}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            取消
          </Button>
          <Button type="button" onClick={handleConfirm} disabled={!canSubmit || busy} loading={busy}>
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
