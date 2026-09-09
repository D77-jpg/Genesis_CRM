/**
 * 客户表单弹窗（新建 / 编辑共用）
 * ------------------------------------------------------------------
 * - react-hook-form + zod 做前端校验，后端返回的字段级错误会回填到对应输入框
 * - Ctrl/Cmd + S 快速保存
 * - 邮箱为空时给出提示：没有邮箱就无法发送开发信
 */
import * as React from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { MailWarning, UserPlus } from 'lucide-react';
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
import { Textarea } from '@/components/ui/textarea';
import { Label, FieldMessage, RequiredMark } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { ApiClientError } from '@/lib/api';
import { defaultCustomerFormValues, customerFormSchema, parseTagsText, type CustomerFormValues } from '@/lib/validators';
import { toInputDate } from '@/lib/format';
import { CUSTOMER_LEAD_SOURCE_OPTIONS, CUSTOMER_PRIORITY_OPTIONS, CUSTOMER_STATUS_OPTIONS } from '@/constants';
import { useCustomerStore } from '@/store/customer.store';
import { selectIsAdmin, useAuthStore } from '@/store/auth.store';
import { useSaveShortcut } from '@/hooks/use-ui';
import type { Customer, CustomerInput, CustomerPriority, CustomerStatus, OwnerOption } from '@/types';

/** 负责人 Select 里表示「未分配」的哨兵值（Radix 不允许 value=""） */
const OWNER_NONE = '__none__';
/** 来源 Select 里表示「未设置」的哨兵值（Radix 不允许 value=""） */
const SOURCE_NONE = '__none__';

export interface CustomerFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 有值 = 编辑模式，无值 = 新建模式 */
  customer?: Customer | null;
  /** 行业下拉候选（来自已有数据） */
  industries?: string[];
  /** 负责人下拉候选 */
  owners?: OwnerOption[];
  /** 保存成功回调（详情页用于刷新档案） */
  onSaved?: (customer: Customer) => void;
}

/** Customer → 表单初值 */
function toFormValues(customer: Customer | null | undefined): CustomerFormValues {
  if (!customer) return { ...defaultCustomerFormValues };
  return {
    name: customer.name ?? '',
    company: customer.company ?? '',
    email: customer.email ?? '',
    phone: customer.phone ?? '',
    title: customer.title ?? '',
    industry: customer.industry ?? '',
    address: customer.address ?? '',
    country: customer.country ?? '',
    website: customer.website ?? '',
    grade: customer.grade ?? '',
    notes: customer.notes ?? '',
    whatsapp: customer.whatsapp ?? '',
    skype: customer.skype ?? '',
    linkedin: customer.linkedin ?? '',
    facebook: customer.facebook ?? '',
    instagram: customer.instagram ?? '',
    interestedProducts: customer.interestedProducts ?? '',
    productModel: customer.productModel ?? '',
    productCategory: customer.productCategory ?? '',
    expectedQuantity: customer.expectedQuantity ?? '',
    targetPrice: customer.targetPrice ?? '',
    moq: customer.moq ?? '',
    requirementNotes: customer.requirementNotes ?? '',
    leadSource: customer.leadSource ?? '',
    priority: customer.priority ?? 'medium',
    status: customer.status ?? 'pending',
    ownerId: customer.ownerId ?? '',
    nextFollowUpAt: toInputDate(customer.nextFollowUpAt),
    tagsText: (customer.tags ?? []).join(', '),
  };
}

/** 表单值 → 接口载荷（空字符串统一转 undefined，避免把已有值清空） */
function toPayload(values: CustomerFormValues): CustomerInput {
  const text = (value?: string): string | undefined => {
    const trimmed = value?.trim();
    return trimmed ? trimmed : undefined;
  };

  return {
    name: values.name.trim(),
    company: text(values.company),
    email: text(values.email)?.toLowerCase(),
    phone: text(values.phone),
    title: text(values.title),
    industry: text(values.industry),
    address: text(values.address),
    country: text(values.country),
    website: text(values.website),
    grade: text(values.grade),
    notes: text(values.notes),
    whatsapp: text(values.whatsapp),
    skype: text(values.skype),
    linkedin: text(values.linkedin),
    facebook: text(values.facebook),
    instagram: text(values.instagram),
    interestedProducts: text(values.interestedProducts),
    productModel: text(values.productModel),
    productCategory: text(values.productCategory),
    expectedQuantity: text(values.expectedQuantity),
    targetPrice: text(values.targetPrice),
    moq: text(values.moq),
    requirementNotes: text(values.requirementNotes),
    leadSource: text(values.leadSource),
    priority: values.priority,
    status: values.status,
    // 负责人 / 下次跟进：空值统一传 null（编辑时表示清除，后端会保留 null 而不跳过）
    ownerId: values.ownerId?.trim() ? values.ownerId.trim() : null,
    nextFollowUpAt: values.nextFollowUpAt?.trim() ? values.nextFollowUpAt.trim() : null,
    tags: parseTagsText(values.tagsText),
  };
}

/** 单个字段的渲染：标签 + 控件 + 错误提示，减少重复 JSX */
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

export function CustomerFormDialog({
  open,
  onOpenChange,
  customer = null,
  industries = [],
  owners = [],
  onSaved,
}: CustomerFormDialogProps): React.JSX.Element {
  const isEdit = Boolean(customer);
  const createCustomer = useCustomerStore((state) => state.createCustomer);
  const updateCustomer = useCustomerStore((state) => state.updateCustomer);
  // 负责人仅管理员可指定；业务员新建的客户后端自动归自己，无需也不允许改归属
  const isAdmin = useAuthStore(selectIsAdmin);

  const [submitting, setSubmitting] = React.useState(false);
  const [serverError, setServerError] = React.useState<string | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    watch,
    setValue,
    setError,
    formState: { errors },
  } = useForm<CustomerFormValues>({
    resolver: zodResolver(customerFormSchema),
    defaultValues: toFormValues(customer),
    mode: 'onBlur',
  });

  // 每次打开时按当前客户重置表单（新建 → 空表单）
  React.useEffect(() => {
    if (open) {
      reset(toFormValues(customer));
      setServerError(null);
    }
  }, [open, customer, reset]);

  const emailValue = watch('email');
  const statusValue = watch('status');
  const ownerValue = watch('ownerId');
  const leadSourceValue = watch('leadSource');
  const priorityValue = watch('priority');

  // 来源选项：预置规范来源；若当前值是自定义（如 Excel 导入的「Dubai Exhibition」），追加进来避免编辑时丢失
  const leadSourceOptions = React.useMemo(() => {
    const current = leadSourceValue?.trim();
    if (current && !CUSTOMER_LEAD_SOURCE_OPTIONS.some((option) => option.value === current)) {
      return [...CUSTOMER_LEAD_SOURCE_OPTIONS, { value: current, label: `${current}（自定义）` }];
    }
    return CUSTOMER_LEAD_SOURCE_OPTIONS;
  }, [leadSourceValue]);

  const submit = React.useCallback(async () => {
    // 触发一次完整校验，失败时 handleSubmit 的回调不会执行
    await handleSubmit(async (values) => {
      setSubmitting(true);
      setServerError(null);
      try {
        const payload = toPayload(values);
        if (isEdit && customer) {
          const saved = await updateCustomer(customer.id, payload);
          toast.success('客户信息已保存', { description: payload.name });
          if (saved) onSaved?.(saved);
        } else {
          const saved = await createCustomer(payload);
          toast.success('客户已创建', { description: payload.name });
          if (saved) onSaved?.(saved);
        }
        onOpenChange(false);
      } catch (error) {
        // 后端字段级错误回填到表单
        if (error instanceof ApiClientError) {
          let mapped = false;
          for (const detail of error.details) {
            const field = (detail.path ?? detail.field ?? '').split('.').pop();
            if (field && field in defaultCustomerFormValues && detail.message) {
              setError(field as keyof CustomerFormValues, { message: detail.message });
              mapped = true;
            }
          }
          if (mapped) setServerError(error.message);
          else setServerError(error.message);
        } else {
          setServerError(error instanceof Error ? error.message : '保存失败，请稍后重试');
        }
      } finally {
        setSubmitting(false);
      }
    })();
  }, [handleSubmit, isEdit, customer, createCustomer, updateCustomer, onOpenChange, onSaved, setError]);

  useSaveShortcut(() => {
    if (open && !submitting) void submit();
  }, open && !submitting);

  const fieldError = (name: keyof CustomerFormValues): string | undefined => errors[name]?.message;

  return (
    <Dialog open={open} onOpenChange={(next) => !submitting && onOpenChange(next)}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {isEdit ? '编辑客户信息' : <UserPlus className="h-4 w-4 text-primary" aria-hidden />}
            {isEdit ? null : '新建客户'}
          </DialogTitle>
          <DialogDescription>
            {isEdit
              ? '修改后立即生效，开发信历史记录不受影响。'
              : '带 * 的为必填项。邮箱用于发送开发信，建议尽量填写。'}
          </DialogDescription>
        </DialogHeader>

        <form
          className="contents"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <div className="-mx-1 min-h-0 flex-1 space-y-4 overflow-y-auto px-1 py-1">
            {serverError ? (
              <Alert variant="destructive">
                <MailWarning aria-hidden />
                <AlertDescription>{serverError}</AlertDescription>
              </Alert>
            ) : null}

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="姓名" required htmlFor="cf-name" error={fieldError('name')}>
                <Input id="cf-name" placeholder="例如 Ella Drake" invalid={Boolean(errors.name)} autoComplete="off" {...register('name')} />
              </Field>

              <Field label="公司" htmlFor="cf-company" error={fieldError('company')}>
                <Input id="cf-company" placeholder="例如 Monarc Jewellery" autoComplete="off" {...register('company')} />
              </Field>

              <Field
                label="邮箱"
                htmlFor="cf-email"
                error={fieldError('email')}
                hint="发送开发信的收件地址；留空后需要在发信时手动填写"
              >
                <Input
                  id="cf-email"
                  type="email"
                  placeholder="name@company.com"
                  invalid={Boolean(errors.email)}
                  autoComplete="off"
                  {...register('email')}
                />
              </Field>

              <Field label="手机号" htmlFor="cf-phone" error={fieldError('phone')}>
                <Input id="cf-phone" placeholder="例如 +64 21 000 0000" autoComplete="off" {...register('phone')} />
              </Field>

              <Field label="职位" htmlFor="cf-title" error={fieldError('title')}>
                <Input id="cf-title" placeholder="例如 Founder / Buyer" autoComplete="off" {...register('title')} />
              </Field>

              <Field label="行业" htmlFor="cf-industry" error={fieldError('industry')}>
                <Input
                  id="cf-industry"
                  placeholder="例如 Fine Jewellery"
                  list="cf-industry-options"
                  autoComplete="off"
                  {...register('industry')}
                />
                <datalist id="cf-industry-options">
                  {industries.map((industry) => (
                    <option key={industry} value={industry} />
                  ))}
                </datalist>
              </Field>

              <Field label="国家 / 地区" htmlFor="cf-country" error={fieldError('country')}>
                <Input id="cf-country" placeholder="例如 New Zealand" autoComplete="off" {...register('country')} />
              </Field>

              <Field label="客户等级" htmlFor="cf-grade" error={fieldError('grade')} hint="例如 A / B / C，便于分层跟进">
                <Input id="cf-grade" placeholder="例如 A" autoComplete="off" {...register('grade')} />
              </Field>

              <Field label="来源" htmlFor="cf-leadsource" error={fieldError('leadSource')} hint="客户从哪个渠道来">
                <Select
                  value={leadSourceValue?.trim() ? leadSourceValue : SOURCE_NONE}
                  onValueChange={(value) => setValue('leadSource', value === SOURCE_NONE ? '' : value, { shouldValidate: true })}
                >
                  <SelectTrigger id="cf-leadsource" invalid={Boolean(errors.leadSource)}>
                    <SelectValue placeholder="未设置" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={SOURCE_NONE}>未设置</SelectItem>
                    {leadSourceOptions.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>

              <Field label="优先级" htmlFor="cf-priority" error={fieldError('priority')} hint="当前跟进的紧急程度，与等级无关">
                <Select
                  value={priorityValue}
                  onValueChange={(value) => setValue('priority', value as CustomerPriority, { shouldValidate: true })}
                >
                  <SelectTrigger id="cf-priority" invalid={Boolean(errors.priority)}>
                    <SelectValue placeholder="请选择优先级" />
                  </SelectTrigger>
                  <SelectContent>
                    {CUSTOMER_PRIORITY_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>

              <Field label="官网" htmlFor="cf-website" error={fieldError('website')} className="sm:col-span-2">
                <Input id="cf-website" placeholder="https://example.com" autoComplete="off" {...register('website')} />
              </Field>

              <Field label="地址" htmlFor="cf-address" error={fieldError('address')} className="sm:col-span-2">
                <Input id="cf-address" placeholder="街道 / 城市 / 邮编" autoComplete="off" {...register('address')} />
              </Field>

              <Field label="开发状态" required htmlFor="cf-status" error={fieldError('status')}>
                <Select
                  value={statusValue}
                  onValueChange={(value) => setValue('status', value as CustomerStatus, { shouldValidate: true })}
                >
                  <SelectTrigger id="cf-status" invalid={Boolean(errors.status)}>
                    <SelectValue placeholder="请选择状态" />
                  </SelectTrigger>
                  <SelectContent>
                    {CUSTOMER_STATUS_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>

              {isAdmin ? (
                <Field label="负责人" htmlFor="cf-owner" error={fieldError('ownerId')} hint="可暂不分配，后续再指定">
                  <Select
                    value={ownerValue?.trim() ? ownerValue : OWNER_NONE}
                    onValueChange={(value) => setValue('ownerId', value === OWNER_NONE ? '' : value, { shouldValidate: true })}
                  >
                    <SelectTrigger id="cf-owner" invalid={Boolean(errors.ownerId)}>
                      <SelectValue placeholder="未分配" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={OWNER_NONE}>未分配</SelectItem>
                      {owners.map((owner) => (
                        <SelectItem key={owner.id} value={owner.id}>
                          {owner.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              ) : null}

              <Field label="下一次跟进" htmlFor="cf-followup" error={fieldError('nextFollowUpAt')} hint="留空表示暂不设置">
                <Input
                  id="cf-followup"
                  type="date"
                  invalid={Boolean(errors.nextFollowUpAt)}
                  autoComplete="off"
                  {...register('nextFollowUpAt')}
                />
              </Field>

              <Field
                label="标签"
                htmlFor="cf-tags"
                error={fieldError('tagsText')}
                hint="多个标签用逗号分隔，例如：珠宝, 高优先级"
              >
                <Input id="cf-tags" placeholder="珠宝, 高优先级" autoComplete="off" {...register('tagsText')} />
              </Field>

              <Field label="备注" htmlFor="cf-notes" error={fieldError('notes')} className="sm:col-span-2">
                <Textarea
                  id="cf-notes"
                  rows={3}
                  placeholder="客户背景、跟进要点、包装需求等"
                  invalid={Boolean(errors.notes)}
                  {...register('notes')}
                />
              </Field>

              {/* ---- 联系方式 ---- */}
              <p className="sm:col-span-2 border-t pt-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                联系方式
              </p>

              <Field label="WhatsApp" htmlFor="cf-whatsapp" error={fieldError('whatsapp')}>
                <Input id="cf-whatsapp" placeholder="例如 +64 21 000 0000" autoComplete="off" {...register('whatsapp')} />
              </Field>

              <Field label="Skype" htmlFor="cf-skype" error={fieldError('skype')}>
                <Input id="cf-skype" placeholder="Skype 账号" autoComplete="off" {...register('skype')} />
              </Field>

              <Field label="LinkedIn" htmlFor="cf-linkedin" error={fieldError('linkedin')} hint="完整 URL 或用户名">
                <Input id="cf-linkedin" placeholder="https://linkedin.com/in/..." autoComplete="off" {...register('linkedin')} />
              </Field>

              <Field label="Facebook" htmlFor="cf-facebook" error={fieldError('facebook')} hint="完整 URL 或主页名">
                <Input id="cf-facebook" placeholder="https://facebook.com/..." autoComplete="off" {...register('facebook')} />
              </Field>

              <Field label="Instagram" htmlFor="cf-instagram" error={fieldError('instagram')} hint="完整 URL 或用户名">
                <Input id="cf-instagram" placeholder="https://instagram.com/..." autoComplete="off" {...register('instagram')} />
              </Field>

              {/* ---- 客户需求 ---- */}
              <p className="sm:col-span-2 border-t pt-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                客户需求
              </p>

              <Field label="感兴趣产品" htmlFor="cf-interested" error={fieldError('interestedProducts')} hint="多个产品用逗号分隔">
                <Input id="cf-interested" placeholder="例如 Solar Panel, Inverter" autoComplete="off" {...register('interestedProducts')} />
              </Field>

              <Field label="产品型号" htmlFor="cf-model" error={fieldError('productModel')}>
                <Input id="cf-model" placeholder="例如 SP-400W" autoComplete="off" {...register('productModel')} />
              </Field>

              <Field label="产品分类" htmlFor="cf-category" error={fieldError('productCategory')}>
                <Input id="cf-category" placeholder="例如 光伏组件" autoComplete="off" {...register('productCategory')} />
              </Field>

              <Field label="预计采购数量" htmlFor="cf-qty" error={fieldError('expectedQuantity')}>
                <Input id="cf-qty" placeholder="例如 5000 pcs" autoComplete="off" {...register('expectedQuantity')} />
              </Field>

              <Field label="目标价格" htmlFor="cf-price" error={fieldError('targetPrice')}>
                <Input id="cf-price" placeholder="例如 USD 0.20/pc" autoComplete="off" {...register('targetPrice')} />
              </Field>

              <Field label="MOQ" htmlFor="cf-moq" error={fieldError('moq')} hint="客户可接受 / 关注的最低起订量">
                <Input id="cf-moq" placeholder="例如 1000 pcs" autoComplete="off" {...register('moq')} />
              </Field>

              <Field label="需求备注" htmlFor="cf-reqnotes" error={fieldError('requirementNotes')} className="sm:col-span-2">
                <Textarea
                  id="cf-reqnotes"
                  rows={3}
                  placeholder="客户的具体需求、认证要求、交期、包装等"
                  invalid={Boolean(errors.requirementNotes)}
                  {...register('requirementNotes')}
                />
              </Field>
            </div>

            {!emailValue?.trim() && (
              <Alert variant="warning">
                <MailWarning aria-hidden />
                <AlertDescription>该客户还没有邮箱，保存后无法直接发送开发信，需要在发信弹窗中手动填写收件人。</AlertDescription>
              </Alert>
            )}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
              取消
            </Button>
            <Button type="submit" loading={submitting}>
              {isEdit ? '保存修改' : '创建客户'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
