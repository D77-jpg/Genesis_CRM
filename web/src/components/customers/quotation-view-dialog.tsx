/**
 * 报价单详情弹窗（查看详情 + 快速改状态）
 * ------------------------------------------------------------------
 * - 只读展示报价全部字段 + 产品明细表（数量 × 单价 = 金额，末行合计），金额一律取后端权威值
 * - 底部「更新状态」：选择新状态，可选「同时把客户标记为报价中」（后端仅在可联动状态时推进）
 * - 编辑 / 删除通过回调交给区域组件（复用表单弹窗与删除确认，避免弹窗套弹窗）
 */
import * as React from 'react';
import { toast } from 'sonner';
import { Pencil, ReceiptText, Trash2, TriangleAlert } from 'lucide-react';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { QuotationStatusBadge } from '@/components/common/status-badge';
import { formatDate, formatDateTime, formatMoney, formatNumber } from '@/lib/format';
import { ApiClientError, toErrorMessage } from '@/lib/api';
import { QUOTATION_STATUS_OPTIONS } from '@/constants';
import { useQuotationStore } from '@/store/quotation.store';
import type { Quotation, QuotationStatus } from '@/types';

export interface QuotationViewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  quotation: Quotation | null;
  customerId: string;
  /** 点击「编辑」：关闭详情，由区域组件打开表单弹窗 */
  onEdit: (quotation: Quotation) => void;
  /** 点击「删除」：关闭详情，由区域组件打开删除确认 */
  onDelete: (quotation: Quotation) => void;
  /** 状态更新成功后：刷新客户档案（可能联动状态）+ 客户动态时间线 */
  onChanged?: () => void;
}

/** 详情里的一格：标签 + 值 */
function Meta({ label, value }: { label: string; value: React.ReactNode }): React.JSX.Element {
  const empty = value === null || value === undefined || value === '';
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 break-words text-sm font-medium">
        {empty ? <span className="font-normal text-muted-foreground">未填写</span> : value}
      </dd>
    </div>
  );
}

export function QuotationViewDialog({
  open,
  onOpenChange,
  quotation,
  customerId,
  onEdit,
  onDelete,
  onChanged,
}: QuotationViewDialogProps): React.JSX.Element {
  const updateQuotationStatus = useQuotationStore((state) => state.updateQuotationStatus);
  const [pendingStatus, setPendingStatus] = React.useState<QuotationStatus>('draft');
  const [markAsQuoting, setMarkAsQuoting] = React.useState(false);
  const [updating, setUpdating] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // 每次打开或切换报价单时，把待提交状态重置为当前状态
  React.useEffect(() => {
    if (open && quotation) {
      setPendingStatus(quotation.status);
      setMarkAsQuoting(false);
      setError(null);
    }
  }, [open, quotation]);

  const handleStatusUpdate = React.useCallback(async () => {
    if (!quotation) return;
    setUpdating(true);
    setError(null);
    try {
      await updateQuotationStatus(customerId, quotation.id, {
        status: pendingStatus,
        ...(markAsQuoting ? { markCustomerAsQuoting: true } : {}),
      });
      toast.success('报价单状态已更新');
      onChanged?.();
      onOpenChange(false);
    } catch (caught) {
      setError(
        caught instanceof ApiClientError ? caught.message : toErrorMessage(caught, '状态更新失败，请稍后重试'),
      );
    } finally {
      setUpdating(false);
    }
  }, [quotation, customerId, pendingStatus, markAsQuoting, updateQuotationStatus, onChanged, onOpenChange]);

  // 状态未变且未勾选联动时无需提交
  const canSubmit = Boolean(quotation) && (pendingStatus !== quotation?.status || markAsQuoting);

  return (
    <Dialog open={open} onOpenChange={(next) => !updating && onOpenChange(next)}>
      <DialogContent className="max-w-2xl">
        {quotation ? (
          <>
            <DialogHeader>
              <DialogTitle className="flex flex-wrap items-center gap-2">
                <ReceiptText className="h-4 w-4 text-primary" aria-hidden />
                <span className="truncate">{quotation.title}</span>
                <span className="rounded border border-border px-1.5 py-0.5 font-mono text-xs font-normal text-muted-foreground">
                  {quotation.quotationNo}
                </span>
              </DialogTitle>
              <DialogDescription className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <QuotationStatusBadge status={quotation.status} showDot />
                <span>创建于 {formatDateTime(quotation.createdAt)}</span>
                <span aria-hidden>·</span>
                <span>更新于 {formatDateTime(quotation.updatedAt)}</span>
              </DialogDescription>
            </DialogHeader>

            <DialogBody className="space-y-5">
              {error ? (
                <Alert variant="destructive">
                  <TriangleAlert aria-hidden />
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              ) : null}

              {/* ---------- 概要 ---------- */}
              <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
                <Meta label="报价总额" value={<span className="text-primary">{formatMoney(quotation.totalAmount, quotation.currency)}</span>} />
                <Meta label="币种" value={quotation.currency} />
                <Meta label="有效期" value={quotation.validityDate ? formatDate(quotation.validityDate) : ''} />
                <Meta label="付款方式" value={quotation.paymentTerms} />
                <Meta label="交期" value={quotation.leadTime} />
                <Meta label="最低起订量 (MOQ)" value={quotation.moq} />
              </dl>

              {/* ---------- 产品明细 ---------- */}
              <div>
                <p className="mb-2 text-xs text-muted-foreground">产品明细（{quotation.items.length} 项）</p>
                <div className="rounded-md border border-border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-10">#</TableHead>
                        <TableHead>产品名称</TableHead>
                        <TableHead>型号</TableHead>
                        <TableHead className="text-right">数量</TableHead>
                        <TableHead className="text-right">单价</TableHead>
                        <TableHead className="text-right">金额</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {quotation.items.map((item, index) => (
                        <TableRow key={`${item.productName}-${index}`}>
                          <TableCell className="text-muted-foreground tabular-nums">{index + 1}</TableCell>
                          <TableCell className="font-medium">{item.productName}</TableCell>
                          <TableCell className="text-muted-foreground">{item.model || '—'}</TableCell>
                          <TableCell className="text-right tabular-nums">{formatNumber(item.quantity)}</TableCell>
                          <TableCell className="text-right tabular-nums">{formatMoney(item.unitPrice)}</TableCell>
                          <TableCell className="text-right font-medium tabular-nums">{formatMoney(item.amount)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                    <TableFooter>
                      <TableRow>
                        <TableCell colSpan={5} className="text-right text-sm">
                          合计（{quotation.currency}）
                        </TableCell>
                        <TableCell className="text-right text-base font-semibold tabular-nums text-primary">
                          {formatMoney(quotation.totalAmount)}
                        </TableCell>
                      </TableRow>
                    </TableFooter>
                  </Table>
                </div>
              </div>

              {/* ---------- 备注 ---------- */}
              {quotation.notes ? (
                <div>
                  <p className="text-xs text-muted-foreground">备注</p>
                  <p className="mt-1 whitespace-pre-wrap rounded-md bg-muted/40 p-3 text-sm leading-relaxed">
                    {quotation.notes}
                  </p>
                </div>
              ) : null}

              {/* ---------- 更新状态（显式客户联动） ---------- */}
              <div className="rounded-lg border border-border bg-muted/20 p-3">
                <div className="flex flex-wrap items-end gap-3">
                  <div className="min-w-[10rem] flex-1">
                    <Label htmlFor="qt-view-status" className="text-xs text-muted-foreground">
                      更新状态
                    </Label>
                    <Select
                      value={pendingStatus}
                      onValueChange={(value) => setPendingStatus(value as QuotationStatus)}
                      disabled={updating}
                    >
                      <SelectTrigger id="qt-view-status" className="mt-1.5">
                        <SelectValue placeholder="选择状态" />
                      </SelectTrigger>
                      <SelectContent>
                        {QUOTATION_STATUS_OPTIONS.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <Button type="button" size="sm" onClick={() => void handleStatusUpdate()} loading={updating} disabled={!canSubmit}>
                    更新状态
                  </Button>
                </div>
                <div className="mt-3 flex items-start gap-2">
                  <Checkbox
                    id="qt-view-mark"
                    checked={markAsQuoting}
                    disabled={updating}
                    onCheckedChange={(checked) => setMarkAsQuoting(checked === true)}
                  />
                  <Label htmlFor="qt-view-mark" className="cursor-pointer text-xs font-normal leading-relaxed text-muted-foreground">
                    同时把客户标记为「报价中」。仅在客户处于待开发 / 已联系 / 已回复 / 有意向时推进，不会覆盖谈判中 / 成交 / 流失等更靠后的状态。
                  </Label>
                </div>
              </div>
            </DialogBody>

            <DialogFooter className="gap-2 sm:justify-between">
              <Button
                type="button"
                variant="outline"
                className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                disabled={updating}
                onClick={() => onDelete(quotation)}
              >
                <Trash2 className="h-4 w-4" aria-hidden />
                删除
              </Button>
              <div className="flex gap-2">
                <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={updating}>
                  关闭
                </Button>
                <Button type="button" onClick={() => onEdit(quotation)} disabled={updating}>
                  <Pencil className="h-4 w-4" aria-hidden />
                  编辑
                </Button>
              </div>
            </DialogFooter>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
