/**
 * 客户详情页的行内可编辑字段
 * ------------------------------------------------------------------
 * 「点击字段值 → 原地变成输入框 → 失焦 / 回车自动保存」，替代原「编辑信息」弹窗。
 * 保存失败（onSave 抛错）时保持编辑态并在行内显示原因，Esc 可放弃修改。
 * 下拉字段没有编辑态：触发器常驻为文本样式，点击展开即选即存，点击其他区域自动收起。
 *
 * 语义约定（与编辑弹窗 / 后端保持一致）：
 * - 文本字段清空 = 不修改（后端把空串归一化为 undefined 并跳过该字段）
 * - 日期 / 负责人等可空字段的清除由调用方把空串或哨兵值映射成 null / []
 */
import * as React from 'react';
import { Pencil } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';

export type InlineFieldKind = 'text' | 'email' | 'date' | 'textarea' | 'select';

export interface InlineSelectOption {
  value: string;
  label: string;
}

export interface EditableInfoRowProps {
  icon: React.ReactNode;
  label: string;
  /** 原始值：展示与编辑都基于它 */
  value?: string | null;
  /** 覆盖展示文案（如格式化后的日期、负责人姓名）；编辑时仍编辑 value */
  displayValue?: string;
  /** 展示态的点击链接（mailto / tel / https），链接点击不打断；编辑走右侧铅笔 */
  href?: string;
  kind?: InlineFieldKind;
  /** 编辑态输入框占位符 */
  placeholder?: string;
  /** kind=select 时的选项（含「未设置 / 未分配」等哨兵项，由调用方映射） */
  options?: InlineSelectOption[];
  /** select 触发器当前应显示的值（哨兵值场景与 value 不同，如未分配的 ownerId） */
  currentSelectValue?: string;
  /** 原生 datalist 候选（行业输入建议） */
  datalistId?: string;
  datalist?: string[];
  maxLength?: number;
  /** kind=textarea 的行数 */
  rows?: number;
  /** 编辑态下方的一行辅助说明 */
  hint?: string;
  /** 自定义展示渲染（如标签徽章、备注块）；值为空时仍显示「未填写」 */
  renderValue?: (raw: string) => React.ReactNode;
  /** kind=select 时追加到触发器的样式（如状态 / 优先级的语义色） */
  selectClassName?: string;
  /** 提交前的轻校验：返回错误文案则不发起保存 */
  validate?: (raw: string) => string | null;
  className?: string;
  /** 保存回调：抛错 = 保存失败（保持编辑态，行内展示错误） */
  onSave: (raw: string) => Promise<void>;
}

export function EditableInfoRow({
  icon,
  label,
  value,
  displayValue,
  href,
  kind = 'text',
  placeholder,
  options,
  currentSelectValue,
  datalistId,
  datalist,
  maxLength,
  rows = 3,
  hint,
  renderValue,
  validate,
  selectClassName,
  className,
  onSave,
}: EditableInfoRowProps): React.JSX.Element {
  const raw = value ?? '';
  const empty = raw.trim() === '';
  const selectCurrent = currentSelectValue ?? raw;

  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(raw);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const textRef = React.useRef<HTMLInputElement | null>(null);
  const areaRef = React.useRef<HTMLTextAreaElement | null>(null);

  // 进入编辑态时聚焦输入框（Select 由 Radix 自行管理焦点）
  React.useEffect(() => {
    if (!editing || kind === 'select') return;
    const element = kind === 'textarea' ? areaRef.current : textRef.current;
    element?.focus();
  }, [editing, kind]);

  const startEdit = React.useCallback(() => {
    if (saving) return;
    setDraft(raw);
    setError(null);
    setEditing(true);
  }, [raw, saving]);

  const cancel = React.useCallback(() => {
    if (saving) return;
    setError(null);
    setEditing(false);
  }, [saving]);

  /** 输入框 / 文本域的提交：值未变直接退出 */
  const commit = React.useCallback(async () => {
    if (saving) return;
    if (draft === raw) {
      setEditing(false);
      return;
    }
    if (validate) {
      const message = validate(draft);
      if (message) {
        setError(message);
        return;
      }
    }
    setSaving(true);
    setError(null);
    try {
      await onSave(draft);
      setEditing(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '保存失败，请稍后重试');
    } finally {
      setSaving(false);
    }
  }, [draft, onSave, raw, saving, validate]);

  /** 下拉选择的提交：选中即保存。下拉没有编辑态，保存失败只在行下展示原因 */
  const commitSelect = React.useCallback(
    async (next: string) => {
      if (saving) return;
      if (next === selectCurrent) return;
      setSaving(true);
      setError(null);
      try {
        await onSave(next);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : '保存失败，请稍后重试');
      } finally {
        setSaving(false);
      }
    },
    [onSave, saving, selectCurrent],
  );

  const handleKeyDown = (event: React.KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      cancel();
      return;
    }
    if (kind === 'textarea') {
      // 文本域用 Ctrl/Cmd + Enter 提交，普通回车保留换行
      if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        void commit();
      }
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      void commit();
    }
  };

  const labelNode = (
    <dt className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <span className="shrink-0" aria-hidden>
        {icon}
      </span>
      {label}
    </dt>
  );

  // 下拉字段没有「编辑态」：触发器常驻渲染成文本样式，点击直接展开选项、
  // 选中即保存；点击页面其他区域由 Radix 自动收起，不会残留输入框外观。
  if (kind === 'select') {
    return (
      <div className={cn('group/row', className)}>
        {labelNode}
        <dd className="mt-1">
          <Select value={selectCurrent || undefined} onValueChange={(next) => void commitSelect(next)}>
            <SelectTrigger
              aria-label={label}
              disabled={saving}
              className={cn(
                '-mx-1 h-auto w-auto max-w-full justify-start gap-1 rounded border-0 bg-transparent px-1 py-0.5',
                'text-sm font-medium shadow-none hover:bg-muted/60 focus:ring-0 focus:ring-offset-0 focus-visible:ring-1 focus-visible:ring-ring/40',
                '[&>span]:min-w-0 [&>span]:truncate [&_[data-placeholder]]:font-normal [&_[data-placeholder]]:text-muted-foreground/80',
                selectClassName,
              )}
            >
              <SelectValue placeholder={placeholder ?? '未设置'} />
            </SelectTrigger>
            <SelectContent>
              {(options ?? []).map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {error ? <p className="mt-1 text-xs text-destructive">{error}</p> : null}
        </dd>
      </div>
    );
  }

  if (editing) {
    return (
      <div className={className}>
        {labelNode}
        <dd className="mt-1">
          {kind === 'textarea' ? (
            <Textarea
              ref={areaRef}
              value={draft}
              rows={rows}
              maxLength={maxLength}
              placeholder={placeholder}
              disabled={saving}
              invalid={Boolean(error)}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={handleKeyDown}
              onBlur={() => void commit()}
            />
          ) : (
            <>
              <Input
                ref={textRef}
                type={kind === 'date' ? 'date' : kind === 'email' ? 'email' : 'text'}
                value={draft}
                maxLength={maxLength}
                placeholder={placeholder}
                list={datalistId}
                disabled={saving}
                invalid={Boolean(error)}
                autoComplete="off"
                onChange={(event) => setDraft(event.target.value)}
                onFocus={(event) => {
                  // 文本类字段进入编辑时全选，方便直接覆盖输入
                  if (kind === 'text' || kind === 'email') event.currentTarget.select();
                }}
                onKeyDown={handleKeyDown}
                onBlur={() => void commit()}
              />
              {datalistId && datalist && datalist.length > 0 ? (
                <datalist id={datalistId}>
                  {datalist.map((item) => (
                    <option key={item} value={item} />
                  ))}
                </datalist>
              ) : null}
            </>
          )}
          {error ? <p className="mt-1 text-xs text-destructive">{error}</p> : hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
        </dd>
      </div>
    );
  }

  return (
    <div className={cn('group/row', className)}>
      {labelNode}
      <dd className="mt-1">
        <div className="flex items-start gap-1">
          {empty ? (
            <button
              type="button"
              onClick={startEdit}
              className="-mx-1 flex-1 rounded px-1 py-0.5 text-left text-sm font-normal text-muted-foreground/80 transition-colors hover:bg-muted/60 hover:text-foreground"
            >
              未填写
            </button>
          ) : href ? (
            <span className="-mx-1 min-w-0 flex-1 break-words px-1 py-0.5 text-sm font-medium">
              <a
                href={href}
                target={href.startsWith('http') ? '_blank' : undefined}
                rel={href.startsWith('http') ? 'noreferrer noopener' : undefined}
                className="text-primary underline-offset-2 hover:underline"
              >
                {displayValue ?? value}
              </a>
            </span>
          ) : (
            <button
              type="button"
              onClick={startEdit}
              className="-mx-1 min-w-0 flex-1 break-words rounded px-1 py-0.5 text-left text-sm font-medium transition-colors hover:bg-muted/60"
            >
              {renderValue ? renderValue(raw) : displayValue ?? value}
            </button>
          )}
          <button
            type="button"
            onClick={startEdit}
            aria-label={`编辑${label}`}
            className="mt-0.5 shrink-0 rounded p-1 text-muted-foreground opacity-0 transition hover:bg-muted hover:text-foreground focus-visible:opacity-100 group-hover/row:opacity-100"
          >
            <Pencil className="h-3 w-3" aria-hidden />
          </button>
        </div>
      </dd>
    </div>
  );
}
