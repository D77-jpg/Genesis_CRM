/**
 * 客户报价单区（V2 报价管理）
 * ------------------------------------------------------------------
 * 自成一体的 Card：内部接管 useQuotationStore 的拉取 / 写操作 / 重置，
 * 详情页只需放进布局，并在报价可能改动客户状态时收到 onCustomerChanged 回调。
 *
 * - 新增：直接从当前客户创建，无需再选客户（customerId 由区域注入）
 * - 编辑 / 查看详情 / 改状态 / 删除：复用表单弹窗、详情弹窗与统一的删除确认
 * - 任一写操作成功后刷新客户档案（可能联动状态）与客户动态时间线（报价事件）
 *   时间线通过 followup.store 的 fetchTimeline 刷新——CustomerActivity 响应式订阅，无需改动 V1 组件
 */
import * as React from 'react';
import { toast } from 'sonner';
import { Plus, ReceiptText } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/common/confirm-dialog';
import { QuotationList } from '@/components/customers/quotation-list';
import { QuotationFormDialog } from '@/components/customers/quotation-form-dialog';
import { QuotationViewDialog } from '@/components/customers/quotation-view-dialog';
import { useQuotationStore } from '@/store/quotation.store';
import { useFollowUpStore } from '@/store/followup.store';
import type { Quotation } from '@/types';

export interface CustomerQuotationsProps {
  customerId: string;
  /** 报价创建 / 改状态可能把客户推进为「报价中」，通知详情页刷新档案 */
  onCustomerChanged?: () => void;
}

export function CustomerQuotations({ customerId, onCustomerChanged }: CustomerQuotationsProps): React.JSX.Element {
  const quotations = useQuotationStore((state) => state.quotations);
  const loading = useQuotationStore((state) => state.loading);
  const mutating = useQuotationStore((state) => state.mutating);
  const error = useQuotationStore((state) => state.error);
  const fetchQuotations = useQuotationStore((state) => state.fetchQuotations);
  const deleteQuotation = useQuotationStore((state) => state.deleteQuotation);
  const reset = useQuotationStore((state) => state.reset);

  const [formOpen, setFormOpen] = React.useState(false);
  // 非空表示编辑该报价单，null 表示新增
  const [formTarget, setFormTarget] = React.useState<Quotation | null>(null);
  const [viewOpen, setViewOpen] = React.useState(false);
  const [viewTarget, setViewTarget] = React.useState<Quotation | null>(null);
  const [deleteTarget, setDeleteTarget] = React.useState<Quotation | null>(null);

  // 切换客户 / 首次挂载时拉取，卸载时清空，避免串客户数据
  React.useEffect(() => {
    if (!customerId) return;
    void fetchQuotations(customerId);
    return () => reset();
  }, [customerId, fetchQuotations, reset]);

  // 报价事件会汇入客户动态时间线；写操作后刷新时间线（复用 followup.store，CustomerActivity 会响应式更新）
  const handleChanged = React.useCallback(() => {
    onCustomerChanged?.();
    void useFollowUpStore.getState().fetchTimeline(customerId);
  }, [onCustomerChanged, customerId]);

  const openCreate = React.useCallback(() => {
    setFormTarget(null);
    setFormOpen(true);
  }, []);

  // 从列表或详情弹窗进入编辑：先关详情，再开表单（预填该报价单）
  const openEdit = React.useCallback((item: Quotation) => {
    setViewOpen(false);
    setViewTarget(null);
    setFormTarget(item);
    setFormOpen(true);
  }, []);

  const openView = React.useCallback((item: Quotation) => {
    setViewTarget(item);
    setViewOpen(true);
  }, []);

  // 关闭表单弹窗时清掉编辑目标，避免下次点「新增」还残留上一条
  const handleFormOpenChange = React.useCallback((next: boolean) => {
    setFormOpen(next);
    if (!next) setFormTarget(null);
  }, []);

  const handleViewOpenChange = React.useCallback((next: boolean) => {
    setViewOpen(next);
    if (!next) setViewTarget(null);
  }, []);

  const confirmDelete = React.useCallback(async () => {
    if (!deleteTarget) return;
    try {
      await deleteQuotation(customerId, deleteTarget.id);
      toast.success('报价单已删除');
      setDeleteTarget(null);
      setViewOpen(false);
      setViewTarget(null);
      handleChanged();
    } catch (caught) {
      toast.error('删除失败', { description: caught instanceof Error ? caught.message : String(caught) });
    }
  }, [customerId, deleteQuotation, deleteTarget, handleChanged]);

  const addButton = (
    <Button type="button" size="sm" onClick={openCreate}>
      <Plus className="h-4 w-4" aria-hidden />
      新增报价
    </Button>
  );

  return (
    <>
      <Card>
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0">
          <div>
            <CardTitle className="flex items-center gap-2">
              <ReceiptText className="h-4 w-4 text-muted-foreground" aria-hidden />
              报价单
              {quotations.length > 0 ? (
                <span className="rounded-full bg-muted px-1.5 text-xs tabular-nums">{quotations.length}</span>
              ) : null}
            </CardTitle>
            <CardDescription>为该客户创建与管理报价，金额由系统统一核算，并留档到客户动态</CardDescription>
          </div>
          {addButton}
        </CardHeader>

        <CardContent>
          <QuotationList
            quotations={quotations}
            loading={loading}
            error={error}
            busy={mutating}
            onRetry={() => void fetchQuotations(customerId)}
            onAdd={openCreate}
            onView={openView}
            onEdit={openEdit}
            onDelete={setDeleteTarget}
          />
        </CardContent>
      </Card>

      <QuotationFormDialog
        open={formOpen}
        onOpenChange={handleFormOpenChange}
        customerId={customerId}
        quotation={formTarget}
        onSaved={handleChanged}
      />

      <QuotationViewDialog
        open={viewOpen}
        onOpenChange={handleViewOpenChange}
        quotation={viewTarget}
        customerId={customerId}
        onEdit={openEdit}
        onDelete={setDeleteTarget}
        onChanged={handleChanged}
      />

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="删除报价单"
        description={
          deleteTarget
            ? `确定要删除报价单「${deleteTarget.quotationNo}」吗？删除后无法恢复，相关客户动态也会一并移除。`
            : undefined
        }
        confirmText="删除"
        variant="destructive"
        loading={mutating}
        onConfirm={confirmDelete}
      />
    </>
  );
}
