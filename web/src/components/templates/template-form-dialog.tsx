/**
 * 开发信模板表单弹窗（新建 / 编辑共用）
 * ------------------------------------------------------------------
 * 复用与「发送开发信」完全相同的富文本编辑器（LetterEditor）与占位符工具条
 * （PlaceholderBar），因此模板天然兼容 16 个客户变量占位符与后续预览 / 发送。
 * 模板不针对某个客户，故占位符工具条传入 values=null（全部按可插入展示）。
 */
import * as React from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { FilePlus2, TriangleAlert } from 'lucide-react';
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
import { Label, FieldMessage, RequiredMark } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { LetterEditor, type LetterEditorHandle } from '@/components/letters/letter-editor';
import { PlaceholderBar } from '@/components/letters/placeholder-bar';
import { ApiClientError } from '@/lib/api';
import {
  defaultTemplateFormValues,
  templateFormSchema,
  type TemplateFormValues,
} from '@/lib/validators';
import { TEMPLATE_CATEGORY_OPTIONS } from '@/constants';
import { useTemplateStore } from '@/store/template.store';
import { selectPlaceholderDefs, useMetaStore } from '@/store/meta.store';
import { useSaveShortcut } from '@/hooks/use-ui';
import type { LetterTemplate, TemplateCategory, TemplateInput } from '@/types';

export interface TemplateFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 有值 = 编辑模式，无值 = 新建模式 */
  template?: LetterTemplate | null;
  onSaved?: (template: LetterTemplate) => void;
}

/** LetterTemplate → 表单初值 */
function toFormValues(template: LetterTemplate | null | undefined): TemplateFormValues {
  if (!template) return { ...defaultTemplateFormValues };
  return {
    name: template.name ?? '',
    subject: template.subject ?? '',
    content: template.content ?? '',
    category: template.category ?? 'first_contact',
  };
}

/** 表单值 → 接口载荷 */
function toPayload(values: TemplateFormValues): TemplateInput {
  return {
    name: values.name.trim(),
    subject: values.subject.trim(),
    content: values.content,
    category: values.category,
  };
}

export function TemplateFormDialog({
  open,
  onOpenChange,
  template = null,
  onSaved,
}: TemplateFormDialogProps): React.JSX.Element {
  const isEdit = Boolean(template);
  const createTemplate = useTemplateStore((state) => state.createTemplate);
  const updateTemplate = useTemplateStore((state) => state.updateTemplate);
  const placeholderDefs = useMetaStore(selectPlaceholderDefs);

  const editorRef = React.useRef<LetterEditorHandle | null>(null);
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
  } = useForm<TemplateFormValues>({
    resolver: zodResolver(templateFormSchema),
    defaultValues: toFormValues(template),
    mode: 'onBlur',
  });

  React.useEffect(() => {
    if (open) {
      reset(toFormValues(template));
      setServerError(null);
    }
  }, [open, template, reset]);

  const categoryValue = watch('category');
  const content = watch('content');

  const submit = React.useCallback(async () => {
    await handleSubmit(async (values) => {
      setSubmitting(true);
      setServerError(null);
      try {
        const payload = toPayload(values);
        const saved = isEdit && template
          ? await updateTemplate(template.id, payload)
          : await createTemplate(payload);
        toast.success(isEdit ? '模板已保存' : '模板已创建', { description: payload.name });
        if (saved) onSaved?.(saved);
        onOpenChange(false);
      } catch (error) {
        if (error instanceof ApiClientError) {
          for (const detail of error.details) {
            const field = (detail.path ?? detail.field ?? '').split('.').pop();
            if (field && field in defaultTemplateFormValues && detail.message) {
              setError(field as keyof TemplateFormValues, { message: detail.message });
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
  }, [handleSubmit, isEdit, template, createTemplate, updateTemplate, onOpenChange, onSaved, setError]);

  useSaveShortcut(() => {
    if (open && !submitting) void submit();
  }, open && !submitting);

  const insertPlaceholder = React.useCallback((token: string) => {
    editorRef.current?.insertAtCursor(token);
  }, []);

  const fieldError = (name: keyof TemplateFormValues): string | undefined => errors[name]?.message;

  return (
    <Dialog open={open} onOpenChange={(next) => !submitting && onOpenChange(next)}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {isEdit ? '编辑模板' : <FilePlus2 className="h-4 w-4 text-primary" aria-hidden />}
            {isEdit ? null : '新建模板'}
          </DialogTitle>
          <DialogDescription>
            正文中的 {'{{占位符}}'} 会在用此模板发送开发信时，自动替换为目标客户的真实信息。
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="space-y-4">
          {serverError ? (
            <Alert variant="destructive">
              <TriangleAlert aria-hidden />
              <AlertDescription>{serverError}</AlertDescription>
            </Alert>
          ) : null}

          <form
            id="template-form"
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="tpl-name" invalid={Boolean(errors.name)}>
                  模板名称
                  <RequiredMark />
                </Label>
                <Input
                  id="tpl-name"
                  className="mt-1.5"
                  placeholder="例如：首次开发 - 珠宝包装"
                  autoComplete="off"
                  invalid={Boolean(errors.name)}
                  {...register('name')}
                />
                <FieldMessage error={fieldError('name')} />
              </div>

              <div>
                <Label htmlFor="tpl-category" invalid={Boolean(errors.category)}>
                  模板分类
                  <RequiredMark />
                </Label>
                <Select
                  value={categoryValue}
                  onValueChange={(value) => setValue('category', value as TemplateCategory, { shouldValidate: true })}
                >
                  <SelectTrigger id="tpl-category" className="mt-1.5" invalid={Boolean(errors.category)}>
                    <SelectValue placeholder="请选择分类" />
                  </SelectTrigger>
                  <SelectContent>
                    {TEMPLATE_CATEGORY_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FieldMessage error={fieldError('category')} />
              </div>

              <div className="sm:col-span-2">
                <Label htmlFor="tpl-subject" invalid={Boolean(errors.subject)}>
                  模板主题
                  <RequiredMark />
                </Label>
                <Input
                  id="tpl-subject"
                  className="mt-1.5"
                  placeholder="例如：{{company}} packaging — samples from {{moq}}"
                  autoComplete="off"
                  invalid={Boolean(errors.subject)}
                  {...register('subject')}
                />
                <FieldMessage error={fieldError('subject')} hint="主题同样支持占位符" />
              </div>
            </div>

            <div>
              <Label htmlFor="tpl-content">
                模板正文
                <RequiredMark />
              </Label>
              <PlaceholderBar
                className="mt-1.5"
                defs={placeholderDefs}
                values={null}
                onInsert={(def) => insertPlaceholder(def.token)}
                disabled={submitting}
              />
              <div id="tpl-content" className="mt-2">
                <LetterEditor
                  ref={editorRef}
                  value={content ?? ''}
                  onChange={(html) => setValue('content', html, { shouldValidate: true, shouldDirty: true })}
                  onBlur={() => setValue('content', content ?? '', { shouldValidate: true })}
                  placeholder="写信正文模板…点击上方按钮可插入客户信息占位符"
                  invalid={Boolean(errors.content)}
                  readOnly={submitting}
                />
              </div>
              <FieldMessage error={fieldError('content')} />
            </div>
          </form>
        </DialogBody>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            取消
          </Button>
          <Button type="submit" form="template-form" loading={submitting}>
            {isEdit ? '保存修改' : '创建模板'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
