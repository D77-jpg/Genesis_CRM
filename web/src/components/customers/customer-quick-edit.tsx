import * as React from 'react';
import { Loader2, User } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/select';
import type { Customer, OwnerOption } from '@/types';

const OWNER_NONE = '__none__';

export type CustomerQuickEditPatch = { ownerId: string };

interface CustomerQuickEditProps {
  customer: Customer;
  owners?: OwnerOption[];
  disabled: boolean;
  onSave: (customer: Customer, patch: CustomerQuickEditPatch) => Promise<void>;
}

/** 负责人仍可快速编辑；客户状态由系统根据开发信、回复和报价自动维护。 */
export function CustomerQuickEdit({
  customer, owners = [], disabled, onSave,
}: CustomerQuickEditProps): React.JSX.Element {
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const errorId = React.useId();
  const value = customer.ownerId || OWNER_NONE;
  const ownerOptions = customer.owner && !owners.some((owner) => owner.id === customer.owner?.id)
    ? [{ ...customer.owner, username: '' }, ...owners]
    : owners;

  async function save(next: string): Promise<void> {
    if (next === value || saving || disabled) return;
    setSaving(true);
    setError(null);
    try {
      await onSave(customer, { ownerId: next === OWNER_NONE ? '' : next });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '保存负责人失败，请重试');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div onClick={(event) => event.stopPropagation()} className="max-w-[12rem]">
      <Select value={value} disabled={disabled || saving} onValueChange={(next) => void save(next)}>
        <SelectTrigger
          aria-label={`修改负责人：${customer.name}`}
          aria-busy={saving}
          aria-describedby={error ? errorId : undefined}
          invalid={Boolean(error)}
          title="点击修改负责人，选择后自动保存"
          className="min-h-11 w-auto min-w-[7rem] gap-1.5 border-transparent px-1.5 py-1 text-xs shadow-none hover:border-input hover:bg-muted/50 md:h-8 md:min-h-8"
        >
          <div className="inline-flex min-w-0 items-center gap-1.5">
            <User className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
            <span className="max-w-[8rem] truncate">{customer.owner?.name || '未分配'}</span>
          </div>
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : null}
        </SelectTrigger>
        <SelectContent onClick={(event) => event.stopPropagation()}>
          <SelectItem value={OWNER_NONE}>未分配</SelectItem>
          {ownerOptions.map((owner) => <SelectItem key={owner.id} value={owner.id}>{owner.name}</SelectItem>)}
        </SelectContent>
      </Select>
      {saving ? <span className="sr-only" role="status">正在保存负责人</span> : null}
      {error ? <p id={errorId} role="alert" className="mt-1 text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
