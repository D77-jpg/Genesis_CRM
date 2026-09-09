/**
 * 新增 / 编辑报价单弹窗（V2 报价管理）
 * ------------------------------------------------------------------
 * - react-hook-form + zod 前端校验，与后端 quotation.validator 对齐；useFieldArray 管理动态明细行
 * - 每行金额与报价总额「即时」显示（前端 roundMoney 计算），提交后由后端再算一次为准
 * - 传入 quotation 则为「编辑模式」（预填 + 走 updateQuotation），否则「新增模式」（走 createQuotation）
 * - 新增模式提供「同时把客户标记为报价中」的显式联动开关；编辑模式不提供（普通编辑不擅自改客户状态）
 * - 报价编号留空则由后端按 QT-YYYYMMDD-NNN 生成；重复时后端返回 409，这里做字段级提示
 */
import * as React from 'react';
import { useForm, useFieldArray, useWatch, type Control } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { Plus, ReceiptText, Trash2, TriangleAlert } from 'lucide-react';
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
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label, FieldMessage, RequiredMark } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { ApiClientError, toErrorMessage } from '@/lib/api';
import { formatMoney, roundMoney, toInputDate } from '@/lib/format';
import {
  defaultQuotationFormValues,
  quotationFormSchema,
  type QuotationFormValues,
} from '@/lib/validators';
import { QUOTATION_CURRENCY_OPTIONS, QUOTATION_STATUS_OPTIONS } from '@/constants';
import { useQuotationStore } from '@/store/quotation.store';
import { useSaveShortcut } from '@/hooks/use-ui';
import type { Quotation, QuotationCurrency, QuotationInput, QuotationStatus } from '@/types';

export interface QuotationFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  customerId: string;
  /** 传入已有报价单则为「编辑模式」，为空则是「新增模式」 */
  quotation?: Quotation | null;
  /** 保存成功后回调：可能联动了客户状态 / 时间线，详情页据此刷新 */
  onSaved?: () => void;
}

/** 表单值 → 接口载荷（编号 / 有效期空串转约定值；明细去掉金额，后端计算） */
function toPayload(values: QuotationFormValues, isEdit: boolean): QuotationInput {
  const text = (value?: string): string | undefined => {
    const trimmed = value?.trim();
    return trimmed ? trimmed : undefined;
  };
  return {
    quotationNo: text(values.quotationNo)?.toUpperCase(),
    title: values.title.trim(),
    items: values.items.map((item) => ({
      productName: item.productName.trim(),
      model: text(item.model),
      quantity: Number(item.quantity) || 0,
      unitPrice: Number(item.unitPrice) || 0,
    })),
    currency: values.currency,
    // 有效期：空串 → null（编辑时清除，新增时表示未设置）
    validityDate: values.validityDate?.trim() ? values.validityDate.trim() : null,
    paymentTerms: text(values.paymentTerms),
    leadTime: text(values.leadTime),
    moq: text(values.moq),
    notes: text(values.notes),
    status: values.status,
    // 普通编辑绝不携带联动标记（后端 updateQuotationSchema 也不接收）
    ...(isEdit ? {} : { markCustomerAsQuoting: values.markCustomerAsQuoting }),
  };
}

/** 已有报价单 → 表单值（编辑模式预填，有效期转成 yyyy-MM-dd） */
function toFormValues(quotation: Quotation): QuotationFormValues {
  return {
    quotationNo: quotation.quotationNo,
    title: quotation.title,
    currency: quotation.currency,
    status: quotation.status,
    validityDate: toInputDate(quotation.validityDate),
    paymentTerms: quotation.paymentTerms ?? '',
    leadTime: quotation.leadTime ?? '',
    moq: quotation.moq ?? '',
    notes: quotation.notes ?? '',
    items: quotation.items.map((item) => ({
      productName: item.productName,
      model: item.model ?? '',
      quantity: item.quantity,
      unitPrice: item.unitPrice,
    })),
    markCustomerAsQuoting: false,
  };
}

/** 单个字段：标签 + 控件 + 错误提示 */
function Field({
  label,
  required,
  error,
  hint,
  htmlFor,
  className,
  children,
}: {
  label: string;
  required?: boolean;
  error?: string;
  hint?: string;
  htmlFor: string;
  className?: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className={className}>
      <Label htmlFor={htmlFor} invalid={Boolean(error)}>
        {label}
        {required ? <RequiredMark /> : null}
      </Label>
      <div className="mt-1.5">{children}</div>
      <FieldMessage error={error} hint={error ? undefined : hint} />
    </div>
  );
}

export function QuotationFormDialog({
  open,
  onOpenChange,
  customerId,
  quotation,
  onSaved,
}: QuotationFormDialogProps): React.JSX.Element {
  const createQuotation = useQuotationStore((state) => state.createQuotation);
  const updateQuotation = useQuotationStore((state) => state.updateQuotation);
  const isEdit = Boolean(quotation);
  const [submitting, setSubmitting] = React.useState(false);
  const [serverError, setServerError] = React.useState<string | null>(null);

  const {
    register,
    control,
    handleSubmit,
    reset,
    watch,
    setValue,
    setError,
    formState: { errors },
  } = useForm<QuotationFormValues>({
    resolver: zodResolver(quotationFormSchema),
    defaultValues: { ...defaultQuotationFormValues },
    mode: 'onBlur',
  });

  const { fields, append, remove } = useFieldArray({ control, name: 'items' });

  // 每次打开时初始化：编辑模式预填，新增模式用默认值（含一行空白明细）
  React.useEffect(() => {
    if (open) {
      reset(quotation ? toFormValues(quotation) : { ...defaultQuotationFormValues });
      setServerError(null);
    }
  }, [open, reset, quotation]);

  // 即时金额：行金额 = 数量 × 单价，总额 = 各行之和（与后端 roundMoney 同口径）
  // 用 useWatch 订阅 items：register 原地修改 item 时 watch('items') 的引用不变，
  // 若再用 useMemo 按引用缓存会导致总额不刷新（只有 append 新行才重算）。
  // 这里每次渲染直接计算（明细行数很少，成本可忽略），保证输入即刷新。
  const watchedItems = useWatch({ control, name: 'items' });
  const currency = watch('currency');
  const status = watch('status');
  const markAsQuoting = watch('markCustomerAsQuoting');
  const lineAmounts = (watchedItems ?? []).map((item) =>
    roundMoney((Number(item?.quantity) || 0) * (Number(item?.unitPrice) || 0)),
  );
  const totalAmount = roundMoney(lineAmounts.reduce((sum, value) => sum + value, 0));

  const submit = React.useCallback(async () => {
    await handleSubmit(async (values) => {
      setSubmitting(true);
      setServerError(null);
      try {
        const payload = toPayload(values, isEdit);
        if (quotation) {
          await updateQuotation(customerId, quotation.id, payload);
          toast.success('报价单已更新');
        } else {
          await createQuotation(customerId, payload);
          toast.success('报价单已创建');
        }
        onSaved?.();
        onOpenChange(false);
      } catch (error) {
        if (error instanceof ApiClientError) {
          // 字段级错误（如明细某行、编号重复）逐项回填
          for (const detail of error.details) {
            const path = detail.path ?? detail.field ?? '';
            if (path && detail.message) setError(path as keyof QuotationFormValues, { message: detail.message });
          }
          setServerError(error.message);
        } else {
          setServerError(toErrorMessage(error, '保存失败，请稍后重试'));
        }
      } finally {
        setSubmitting(false);
      }
    })();
  }, [handleSubmit, customerId, quotation, isEdit, createQuotation, updateQuotation, onOpenChange, onSaved, setError]);

  useSaveShortcut(() => {
    if (open && !submitting) void submit();
  }, open && !submitting);

  const itemError = (index: number, name: 'productName' | 'model' | 'quantity' | 'unitPrice'): string | undefined =>
    errors.items?.[index]?.[name]?.message;

  const itemsRootError =
    typeof errors.items?.message === 'string'
      ? errors.items.message
      : typeof errors.items?.root?.message === 'string'
        ? errors.items.root.message
        : undefined;

  return (
    <Dialog open={open} onOpenChange={(next) => !submitting && onOpenChange(next)}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ReceiptText className="h-4 w-4 text-primary" aria-hidden />
            {isEdit ? '编辑报价单' : '新增报价单'}
          </DialogTitle>
          <DialogDescription>
            {isEdit
              ? '修改报价信息与产品明细，金额会自动重算。带 * 的为必填项。'
              : '为当前客户创建报价单，编号留空则自动生成。带 * 的为必填项。'}
          </DialogDescription>
        </DialogHeader>

        <form
          className="contents"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <DialogBody className="space-y-5">
            {serverError ? (
              <Alert variant="destructive">
                <TriangleAlert aria-hidden />
                <AlertDescription>{serverError}</AlertDescription>
              </Alert>
            ) : null}

            {/* ---------- 基本信息 ---------- */}
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="报价编号" htmlFor="qt-no" error={errors.quotationNo?.message} hint="留空自动生成 QT-日期-序号">
                <Input
                  id="qt-no"
                  placeholder="例如 QT-20260909-001"
                  autoComplete="off"
                  invalid={Boolean(errors.quotationNo)}
                  {...register('quotationNo')}
                />
              </Field>

              <Field label="报价标题" required htmlFor="qt-title" error={errors.title?.message}>
                <Input
                  id="qt-title"
                  placeholder="例如 Stainless Steel Ring — Sept 2026"
                  autoComplete="off"
                  invalid={Boolean(errors.title)}
                  {...register('title')}
                />
              </Field>

              <Field label="币种" required htmlFor="qt-currency" error={errors.currency?.message}>
                <Select value={currency} onValueChange={(value) => setValue('currency', value as QuotationCurrency, { shouldValidate: true })}>
                  <SelectTrigger id="qt-currency" invalid={Boolean(errors.currency)}>
                    <SelectValue placeholder="请选择币种" />
                  </SelectTrigger>
                  <SelectContent>
                    {QUOTATION_CURRENCY_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>

              <Field label="状态" required htmlFor="qt-status" error={errors.status?.message}>
                <Select value={status} onValueChange={(value) => setValue('status', value as QuotationStatus, { shouldValidate: true })}>
                  <SelectTrigger id="qt-status" invalid={Boolean(errors.status)}>
                    <SelectValue placeholder="请选择状态" />
                  </SelectTrigger>
                  <SelectContent>
                    {QUOTATION_STATUS_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>

              <Field label="有效期" htmlFor="qt-validity" error={errors.validityDate?.message} hint="报价的有效截止日期">
                <Input
                  id="qt-validity"
                  type="date"
                  autoComplete="off"
                  invalid={Boolean(errors.validityDate)}
                  {...register('validityDate')}
                />
              </Field>

              <Field label="最低起订量 (MOQ)" htmlFor="qt-moq" error={errors.moq?.message}>
                <Input id="qt-moq" placeholder="例如 100 pcs" autoComplete="off" invalid={Boolean(errors.moq)} {...register('moq')} />
              </Field>

              <Field label="付款方式" htmlFor="qt-payment" error={errors.paymentTerms?.message}>
                <Input
                  id="qt-payment"
                  placeholder="例如 30% deposit, 70% before shipment"
                  autoComplete="off"
                  invalid={Boolean(errors.paymentTerms)}
                  {...register('paymentTerms')}
                />
              </Field>

              <Field label="交期" htmlFor="qt-leadtime" error={errors.leadTime?.message}>
                <Input id="qt-leadtime" placeholder="例如 20-25 days" autoComplete="off" invalid={Boolean(errors.leadTime)} {...register('leadTime')} />
              </Field>
            </div>

            {/* ---------- 产品明细（动态行 + 即时金额） ---------- */}
            <div>
              <div className="mb-2 flex items-center justify-between">
                <Label className="gap-1">
                  产品明细
                  <RequiredMark />
                </Label>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => append({ productName: '', model: '', quantity: 1, unitPrice: 0 }, { shouldFocus: true })}
                >
                  <Plus className="h-4 w-4" aria-hidden />
                  添加产品行
                </Button>
              </div>

              <div className="space-y-3">
                {fields.map((field, index) => (
                  <div key={field.id} className="rounded-lg border border-border bg-muted/20 p-3">
                    <div className="mb-2 flex items-center justify-between">
                      <span className="text-xs font-medium text-muted-foreground">明细 #{index + 1}</span>
                      <div className="flex items-center gap-3">
                        <span className="text-sm font-semibold tabular-nums">
                          {formatMoney(lineAmounts[index] ?? 0, currency)}
                        </span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-muted-foreground hover:text-destructive disabled:opacity-40"
                          aria-label={`删除明细 #${index + 1}`}
                          disabled={fields.length <= 1}
                          onClick={() => remove(index)}
                        >
                          <Trash2 className="h-3.5 w-3.5" aria-hidden />
                        </Button>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-12">
                      <Field
                        label="产品名称"
                        required
                        htmlFor={`qt-item-${index}-name`}
                        error={itemError(index, 'productName')}
                        className="col-span-2 sm:col-span-4"
                      >
                        <Input
                          id={`qt-item-${index}-name`}
                          placeholder="产品名称"
                          autoComplete="off"
                          invalid={Boolean(itemError(index, 'productName'))}
                          {...register(`items.${index}.productName`)}
                        />
                      </Field>

                      <Field label="型号" htmlFor={`qt-item-${index}-model`} error={itemError(index, 'model')} className="col-span-2 sm:col-span-3">
                        <Input
                          id={`qt-item-${index}-model`}
                          placeholder="型号 / 规格"
                          autoComplete="off"
                          invalid={Boolean(itemError(index, 'model'))}
                          {...register(`items.${index}.model`)}
                        />
                      </Field>

                      <Field label="数量" required htmlFor={`qt-item-${index}-qty`} error={itemError(index, 'quantity')} className="sm:col-span-2">
                        <Input
                          id={`qt-item-${index}-qty`}
                          type="number"
                          min={0}
                          step={1}
                          inputMode="numeric"
                          autoComplete="off"
                          invalid={Boolean(itemError(index, 'quantity'))}
                          {...register(`items.${index}.quantity`)}
                        />
                      </Field>

                      <Field label="单价" required htmlFor={`qt-item-${index}-price`} error={itemError(index, 'unitPrice')} className="sm:col-span-2">
                        <Input
                          id={`qt-item-${index}-price`}
                          type="number"
                          min={0}
                          step="0.01"
                          inputMode="decimal"
                          autoComplete="off"
                          invalid={Boolean(itemError(index, 'unitPrice'))}
                          {...register(`items.${index}.unitPrice`)}
                        />
                      </Field>
                    </div>
                  </div>
                ))}
              </div>

              {itemsRootError ? <FieldMessage error={itemsRootError} /> : null}

              {/* 报价总额：随明细即时变化 */}
              <div className="mt-3 flex items-center justify-between rounded-lg border border-primary/30 bg-primary/5 px-4 py-3">
                <span className="text-sm font-medium">报价总额</span>
                <span className="text-lg font-semibold tabular-nums text-primary">{formatMoney(totalAmount, currency)}</span>
              </div>
            </div>

            {/* ---------- 备注 ---------- */}
            <Field label="备注" htmlFor="qt-notes" error={errors.notes?.message}>
              <Textarea
                id="qt-notes"
                rows={3}
                placeholder="报价说明、贸易术语（FOB/CIF）、包装、样品政策等。"
                invalid={Boolean(errors.notes)}
                {...register('notes')}
              />
            </Field>

            {/* ---------- 显式状态联动（仅新增） ---------- */}
            {!isEdit ? (
              <div className="flex items-start gap-3 rounded-lg border border-border bg-muted/30 p-3">
                <Switch
                  id="qt-mark-quoting"
                  checked={Boolean(markAsQuoting)}
                  disabled={submitting}
                  onCheckedChange={(checked) => setValue('markCustomerAsQuoting', checked)}
                />
                <div>
                  <Label htmlFor="qt-mark-quoting" className="cursor-pointer text-sm font-medium">
                    同时把客户标记为「报价中」
                  </Label>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    仅在客户处于待开发 / 已联系 / 已回复 / 有意向时推进，不会覆盖谈判中 / 成交 / 流失等更靠后的状态。
                  </p>
                </div>
              </div>
            ) : null}
          </DialogBody>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
              取消
            </Button>
            <Button type="submit" loading={submitting}>
              {isEdit ? '保存修改' : '创建报价单'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** 供 useFieldArray 类型推断使用的辅助导出（保持 control 类型与表单一致） */
export type QuotationItemsControl = Control<QuotationFormValues>;
