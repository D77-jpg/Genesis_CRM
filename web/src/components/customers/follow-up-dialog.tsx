/**
 * 新增 / 编辑跟进记录弹窗
 * ------------------------------------------------------------------
 * - react-hook-form + zod 前端校验，与后端 createFollowUpSchema 对齐
 * - 传入 followUp 则为编辑模式（预填已有记录，提交走 updateFollowUp），否则为新增模式
 * - 方式 / 结果用 Select（Radix 不允许 value=""，这里都有默认值无需哨兵）
 * - 若填写了「下一次跟进时间」，后端会同步到客户主档，故提交成功后需要详情页刷新客户档案
 */
import * as React from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { NotebookPen, TriangleAlert } from 'lucide-react';
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
import { toInputDate } from '@/lib/format';
import {
  defaultFollowUpFormValues,
  followUpFormSchema,
  type FollowUpFormValues,
} from '@/lib/validators';
import { FOLLOW_UP_METHOD_OPTIONS, FOLLOW_UP_RESULT_OPTIONS } from '@/constants';
import { useFollowUpStore } from '@/store/followup.store';
import { useSaveShortcut } from '@/hooks/use-ui';
import type { FollowUp, FollowUpInput, FollowUpMethod, FollowUpResult } from '@/types';

export interface FollowUpDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  customerId: string;
  /** 传入已有跟进记录则为「编辑模式」，为空则是「新增模式」 */
  followUp?: FollowUp | null;
  /** 保存（新增 / 编辑）成功后回调：可能同步了 nextFollowUpAt，详情页据此刷新客户档案 */
  onSaved?: () => void;
}

/** 表单值 → 接口载荷（时间空串转 undefined，让后端按默认处理） */
function toPayload(values: FollowUpFormValues): FollowUpInput {
  const date = (value?: string): string | null | undefined => {
    const trimmed = value?.trim();
    return trimmed ? trimmed : null;
  };
  return {
    method: values.method,
    content: values.content.trim(),
    result: values.result,
    followUpAt: values.followUpAt?.trim() ? values.followUpAt.trim() : undefined,
    nextFollowUpAt: date(values.nextFollowUpAt),
  };
}

/** 已有跟进记录 → 表单值（编辑模式预填，时间转成 yyyy-MM-dd） */
function toFormValues(followUp: FollowUp): FollowUpFormValues {
  return {
    method: followUp.method,
    content: followUp.content,
    result: followUp.result,
    followUpAt: toInputDate(followUp.followUpAt),
    nextFollowUpAt: toInputDate(followUp.nextFollowUpAt),
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

export function FollowUpDialog({
  open,
  onOpenChange,
  customerId,
  followUp,
  onSaved,
}: FollowUpDialogProps): React.JSX.Element {
  const createFollowUp = useFollowUpStore((state) => state.createFollowUp);
  const updateFollowUp = useFollowUpStore((state) => state.updateFollowUp);
  const isEdit = Boolean(followUp);
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
  } = useForm<FollowUpFormValues>({
    resolver: zodResolver(followUpFormSchema),
    defaultValues: { ...defaultFollowUpFormValues },
    mode: 'onBlur',
  });

  // 每次打开时初始化：编辑模式预填已有记录，新增模式用默认值（跟进时间 = 今天）
  React.useEffect(() => {
    if (open) {
      reset(followUp ? toFormValues(followUp) : { ...defaultFollowUpFormValues });
      setServerError(null);
    }
  }, [open, reset, followUp]);

  const methodValue = watch('method');
  const resultValue = watch('result');

  const submit = React.useCallback(async () => {
    await handleSubmit(async (values) => {
      setSubmitting(true);
      setServerError(null);
      try {
        if (followUp) {
          await updateFollowUp(customerId, followUp.id, toPayload(values));
          toast.success('跟进记录已更新');
        } else {
          await createFollowUp(customerId, toPayload(values));
          toast.success('跟进记录已保存');
        }
        onSaved?.();
        onOpenChange(false);
      } catch (error) {
        if (error instanceof ApiClientError) {
          for (const detail of error.details) {
            const field = (detail.path ?? detail.field ?? '').split('.').pop();
            if (field && field in defaultFollowUpFormValues && detail.message) {
              setError(field as keyof FollowUpFormValues, { message: detail.message });
            }
          }
          setServerError(error.message);
        } else {
          setServerError(error instanceof Error ? error.message : '保存失败，请稍后重试');
        }
      } finally {
        setSubmitting(false);
      }
    })();
  }, [handleSubmit, customerId, followUp, createFollowUp, updateFollowUp, onOpenChange, onSaved, setError]);

  useSaveShortcut(() => {
    if (open && !submitting) void submit();
  }, open && !submitting);

  const fieldError = (name: keyof FollowUpFormValues): string | undefined => errors[name]?.message;

  return (
    <Dialog open={open} onOpenChange={(next) => !submitting && onOpenChange(next)}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <NotebookPen className="h-4 w-4 text-primary" aria-hidden />
            {isEdit ? '编辑跟进记录' : '新增跟进记录'}
          </DialogTitle>
          <DialogDescription>
            {isEdit
              ? '修改这次联系的方式与结果，保存后立即刷新列表。带 * 的为必填项。'
              : '记录这次联系的方式与结果，方便后续追溯。带 * 的为必填项。'}
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
                <TriangleAlert aria-hidden />
                <AlertDescription>{serverError}</AlertDescription>
              </Alert>
            ) : null}

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="跟进方式" required htmlFor="fu-method" error={fieldError('method')}>
                <Select
                  value={methodValue}
                  onValueChange={(value) => setValue('method', value as FollowUpMethod, { shouldValidate: true })}
                >
                  <SelectTrigger id="fu-method" invalid={Boolean(errors.method)}>
                    <SelectValue placeholder="请选择方式" />
                  </SelectTrigger>
                  <SelectContent>
                    {FOLLOW_UP_METHOD_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>

              <Field label="跟进结果" required htmlFor="fu-result" error={fieldError('result')}>
                <Select
                  value={resultValue}
                  onValueChange={(value) => setValue('result', value as FollowUpResult, { shouldValidate: true })}
                >
                  <SelectTrigger id="fu-result" invalid={Boolean(errors.result)}>
                    <SelectValue placeholder="请选择结果" />
                  </SelectTrigger>
                  <SelectContent>
                    {FOLLOW_UP_RESULT_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>

              <Field label="跟进时间" htmlFor="fu-at" error={fieldError('followUpAt')} hint="默认为今天">
                <Input
                  id="fu-at"
                  type="date"
                  invalid={Boolean(errors.followUpAt)}
                  autoComplete="off"
                  {...register('followUpAt')}
                />
              </Field>

              <Field
                label="下一次跟进"
                htmlFor="fu-next"
                error={fieldError('nextFollowUpAt')}
                hint="填写后会同步到客户主档"
              >
                <Input
                  id="fu-next"
                  type="date"
                  invalid={Boolean(errors.nextFollowUpAt)}
                  autoComplete="off"
                  {...register('nextFollowUpAt')}
                />
              </Field>

              <Field
                label="跟进内容"
                required
                htmlFor="fu-content"
                error={fieldError('content')}
                className="sm:col-span-2"
              >
                <Textarea
                  id="fu-content"
                  rows={4}
                  placeholder="例如：已通过 WhatsApp 沟通报价，客户对 MOQ 有疑问，下周一再跟进。"
                  invalid={Boolean(errors.content)}
                  {...register('content')}
                />
              </Field>
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
              取消
            </Button>
            <Button type="submit" loading={submitting}>
              {isEdit ? '保存修改' : '保存跟进'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
