/**
 * 发送开发信弹窗
 * ------------------------------------------------------------------
 * 产品主流程：客户详情 →「发送开发信」→ 填写主题/正文 → 发送 → 落库 → 刷新历史。
 *
 * 设计要点：
 *  - 正文支持 {{占位符}}，发送时由后端渲染（前端本地预览仅为辅助，最终以后端为准）
 *  - 「预览」页签实时渲染占位符，用户能看到客户真正会收到的内容
 *  - 收件人邮箱可改：客户档案没有邮箱时也能手动指定
 *  - 可选「发送后标记为已联系」，默认开启（与后端默认值一致）
 *  - 支持存草稿；重发时带出原模板
 */
import * as React from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import {
  Building2,
  Eye,
  FileText,
  Info,
  Mail,
  PencilLine,
  Save,
  Send,
  TriangleAlert,
  User,
} from 'lucide-react';
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
import { Label, FieldMessage } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { CustomerStatusBadge } from '@/components/common/status-badge';
import { LetterEditor, type LetterEditorHandle } from './letter-editor';
import { PlaceholderBar } from './placeholder-bar';
import { sendLetterSchema, type SendLetterFormValues } from '@/lib/validators';
import { buildPlaceholderValues, findMissingPlaceholders, renderTemplate } from '@/lib/placeholder';
import { toErrorMessage } from '@/lib/api';
import { readStorage, writeStorage } from '@/lib/utils';
import { useDebouncedValue } from '@/hooks/use-debounce';
import { useSaveShortcut } from '@/hooks/use-ui';
import { useLetterStore } from '@/store/letter.store';
import { useTemplateStore } from '@/store/template.store';
import { selectCompany, selectPlaceholderDefs, useMetaStore } from '@/store/meta.store';
import {
  DEFAULT_LETTER_SUBJECT,
  DEFAULT_LETTER_TEMPLATE,
  MAIL_CHANNEL_LABEL,
  STORAGE_KEYS,
  TEMPLATE_CATEGORY_LABEL,
} from '@/constants';
import type { Customer, DevelopmentLetter, SendLetterResult } from '@/types';

export interface SendLetterDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 目标客户；为空时不允许发送 */
  customer: Customer | null;
  /** 重发场景：带出原信的主题与模板 */
  letter?: DevelopmentLetter | null;
  /** 发送 / 存草稿成功后回调，父级据此刷新历史列表与客户信息 */
  onSent?: (result: SendLetterResult) => void;
}

/** 记住上次用过的模板，连续给多个客户发信时不用重写 */
interface SavedTemplate {
  subject: string;
  content: string;
}

function loadSavedTemplate(): SavedTemplate | null {
  const saved = readStorage<SavedTemplate | null>(STORAGE_KEYS.lastTemplate, null);
  if (saved && typeof saved.subject === 'string' && typeof saved.content === 'string') return saved;
  return null;
}

/** 模板选择器的占位值（Radix Select 不接受空字符串；选中即回填表单，不持久化选中态） */
const TEMPLATE_PICK_NONE = '__none__';

/** 弹窗顶部的收件人预览卡 */
function RecipientCard({ customer }: { customer: Customer }): React.JSX.Element {
  return (
    <div className="rounded-lg border bg-muted/30 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2.5">
          <span
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary"
            aria-hidden
          >
            <User className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{customer.name}</p>
            <p className="truncate text-xs text-muted-foreground">
              {customer.title ? `${customer.title} · ` : ''}
              {customer.company || '未填写公司'}
            </p>
          </div>
        </div>
        <CustomerStatusBadge status={customer.status} />
      </div>

      <dl className="mt-2.5 grid gap-x-4 gap-y-1 text-xs sm:grid-cols-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <Mail className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
          <dt className="sr-only">邮箱</dt>
          <dd className="truncate">{customer.email || '未填写'}</dd>
        </div>
        <div className="flex items-center gap-1.5 min-w-0">
          <Building2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
          <dt className="sr-only">行业</dt>
          <dd className="truncate">{customer.industry || '未填写行业'}</dd>
        </div>
      </dl>
    </div>
  );
}

export function SendLetterDialog({
  open,
  onOpenChange,
  customer,
  letter = null,
  onSent,
}: SendLetterDialogProps): React.JSX.Element {
  const sendLetter = useLetterStore((state) => state.sendLetter);
  const resendLetter = useLetterStore((state) => state.resendLetter);
  const sending = useLetterStore((state) => state.sending);

  const placeholderDefs = useMetaStore(selectPlaceholderDefs);
  const company = useMetaStore(selectCompany);
  const channel = useMetaStore((state) => state.mailChannel);

  const templateItems = useTemplateStore((state) => state.items);
  const fetchTemplates = useTemplateStore((state) => state.fetchList);

  const editorRef = React.useRef<LetterEditorHandle | null>(null);
  const [activeTab, setActiveTab] = React.useState<'edit' | 'preview'>('edit');
  const [serverError, setServerError] = React.useState<string | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    watch,
    setValue,
    formState: { errors },
  } = useForm<SendLetterFormValues>({
    resolver: zodResolver(sendLetterSchema),
    defaultValues: {
      subject: '',
      content: '',
      recipientEmail: '',
      markAsDeveloped: true,
      saveAsDraft: false,
    },
    mode: 'onBlur',
  });

  /* ---------------------------- 打开时初始化 ---------------------------- */

  // 只依赖 id：避免列表刷新导致 customer 对象引用变化时把用户正在写的内容重置掉
  const customerId = customer?.id;
  const letterId = letter?.id;

  React.useEffect(() => {
    if (!open) return;

    setActiveTab('edit');
    setServerError(null);

    // 优先级：重发的原信 > 上次使用的模板 > 内置默认模板
    const source = letter
      ? { subject: letter.subject, content: letter.template || letter.content }
      : (loadSavedTemplate() ?? { subject: DEFAULT_LETTER_SUBJECT, content: DEFAULT_LETTER_TEMPLATE });

    reset({
      subject: source.subject ?? '',
      content: source.content ?? '',
      recipientEmail: letter?.recipientEmail ?? customer?.email ?? '',
      // 只有「待开发」客户才需要推进状态，已联系及之后的客户默认关掉更贴合直觉
      markAsDeveloped: customer?.status === 'pending',
      saveAsDraft: false,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 仅在「打开 / 客户 / 原信」变化时重建表单
  }, [open, customerId, letterId, reset]);

  // 打开时确保模板列表已加载（供「从模板导入」选择器使用；已加载则不重复请求）
  React.useEffect(() => {
    if (open && templateItems.length === 0) void fetchTemplates();
  }, [open, templateItems.length, fetchTemplates]);

  /* ---------------------------- 本地实时预览 ---------------------------- */

  const subject = watch('subject');
  const content = watch('content');
  const recipientEmail = watch('recipientEmail');
  const markAsDeveloped = watch('markAsDeveloped');

  const placeholderValues = React.useMemo(() => buildPlaceholderValues(customer, company), [customer, company]);

  const debouncedContent = useDebouncedValue(content ?? '', 250);
  const debouncedSubject = useDebouncedValue(subject ?? '', 250);

  const preview = React.useMemo(
    () => ({
      subject: renderTemplate(debouncedSubject, placeholderValues, { escape: false }),
      html: renderTemplate(debouncedContent, placeholderValues, { escape: true }),
    }),
    [debouncedSubject, debouncedContent, placeholderValues],
  );

  const missingPlaceholders = React.useMemo(
    () => findMissingPlaceholders(`${subject ?? ''}${content ?? ''}`, placeholderValues),
    [subject, content, placeholderValues],
  );

  const missingLabels = React.useMemo(
    () =>
      missingPlaceholders
        .map((key) => placeholderDefs.find((def) => def.key === key)?.label ?? key)
        .slice(0, 6),
    [missingPlaceholders, placeholderDefs],
  );

  /* ---------------------------- 提交 ---------------------------- */

  const submit = React.useCallback(
    async (asDraft: boolean) => {
      if (!customer) {
        setServerError('缺少客户信息，无法发送开发信');
        return;
      }

      await handleSubmit(async (values) => {
        setServerError(null);
        try {
          const result = letter
            ? await resendLetter(letter.id, {
                subject: values.subject,
                content: values.content,
                recipientEmail: values.recipientEmail,
                markAsDeveloped: values.markAsDeveloped,
              })
            : await sendLetter({
                customerId: customer.id,
                subject: values.subject,
                content: values.content,
                recipientEmail: values.recipientEmail,
                markAsDeveloped: values.markAsDeveloped,
                saveAsDraft: asDraft,
              });

          // 记住模板，便于连续发信
          writeStorage(STORAGE_KEYS.lastTemplate, { subject: values.subject, content: values.content });

          if (asDraft) {
            toast.success('草稿已保存', { description: result.message || '可在开发信记录中继续编辑发送' });
          } else if (!result.delivered) {
            // 发送失败但已落库：给出可操作提示
            toast.error('发送失败，记录已保存', { description: result.message });
          } else if (result.channel === 'mock') {
            toast.info(result.message || '开发信已记录（模拟发送）', {
              description: `通道：${MAIL_CHANNEL_LABEL[result.channel] ?? result.channel}`,
            });
          } else {
            toast.success(result.message || '开发信已发送', { description: `收件人：${result.letter.recipientEmail}` });
          }

          onSent?.(result);
          onOpenChange(false);
        } catch (error) {
          // store 已把后端错误转成中文提示，这里直接展示
          setServerError(toErrorMessage(error, asDraft ? '保存草稿失败' : '开发信发送失败'));
        }
      })();
    },
    [customer, letter, handleSubmit, sendLetter, resendLetter, onSent, onOpenChange],
  );

  // Ctrl/Cmd + S = 存草稿；Ctrl/Cmd + Enter = 发送
  useSaveShortcut(() => {
    if (open && !sending) void submit(true);
  }, open && !sending);

  React.useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
        event.preventDefault();
        void submit(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, submit]);

  const handleOpenChange = React.useCallback(
    (next: boolean) => {
      if (sending) return;
      onOpenChange(next);
    },
    [sending, onOpenChange],
  );

  const insertPlaceholder = React.useCallback(
    (token: string) => {
      editorRef.current?.insertAtCursor(token);
      setActiveTab('edit');
    },
    [],
  );

  // 选择模板：把模板的主题与正文一键带入表单（复用同一套编辑器与占位符，不改发送逻辑）
  const handleApplyTemplate = React.useCallback(
    (id: string) => {
      if (id === TEMPLATE_PICK_NONE) return;
      const template = templateItems.find((item) => item.id === id);
      if (!template) return;
      setValue('subject', template.subject ?? '', { shouldValidate: true, shouldDirty: true });
      setValue('content', template.content ?? '', { shouldValidate: true, shouldDirty: true });
      setActiveTab('edit');
      toast.success('已导入模板', { description: template.name });
    },
    [templateItems, setValue],
  );

  const contentLength = (content ?? '').replace(/<[^>]*>/g, '').replace(/&nbsp;/gi, ' ').trim().length;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Send className="h-4 w-4 text-primary" aria-hidden />
            {letter ? '重新发送开发信' : '发送开发信'}
          </DialogTitle>
          <DialogDescription>
            {letter
              ? '已带出原信内容，可修改后再次发送；会新增一条发送记录。'
              : '正文中的 {{占位符}} 会在发送时自动替换为该客户的真实信息。'}
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="space-y-4">
          {customer ? <RecipientCard customer={customer} /> : null}

          {serverError ? (
            <Alert variant="destructive">
              <TriangleAlert aria-hidden />
              <AlertTitle>操作未完成</AlertTitle>
              <AlertDescription>{serverError}</AlertDescription>
            </Alert>
          ) : null}

          {channel === 'mock' ? (
            <Alert variant="warning">
              <Info aria-hidden />
              <AlertDescription>
                当前为{MAIL_CHANNEL_LABEL.mock}模式：开发信会完整保存到该客户的记录中，但不会真正投递邮件。
                在 server/.env 配置 SMTP_* 后重启后端即可切换为真实发送。
              </AlertDescription>
            </Alert>
          ) : null}

          <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as 'edit' | 'preview')}>
            <TabsList>
              <TabsTrigger value="edit">
                <PencilLine className="h-3.5 w-3.5" aria-hidden />
                编辑
              </TabsTrigger>
              <TabsTrigger value="preview">
                <Eye className="h-3.5 w-3.5" aria-hidden />
                预览
              </TabsTrigger>
            </TabsList>

            {/* ---------------- 编辑 ---------------- */}
            <TabsContent value="edit" className="space-y-4 pt-1">
              {templateItems.length > 0 ? (
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 rounded-md border border-dashed bg-muted/20 px-3 py-2">
                  <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="text-xs text-muted-foreground">从模板导入</span>
                  <Select value={TEMPLATE_PICK_NONE} onValueChange={handleApplyTemplate}>
                    <SelectTrigger className="h-7 w-auto min-w-[9rem] max-w-full text-xs" aria-label="选择模板">
                      <SelectValue placeholder="选择模板…" />
                    </SelectTrigger>
                    <SelectContent>
                      {templateItems.map((template) => (
                        <SelectItem key={template.id} value={template.id} className="text-xs">
                          <span className="mr-1.5 text-2xs text-muted-foreground">
                            [{TEMPLATE_CATEGORY_LABEL[template.category] ?? template.category}]
                          </span>
                          {template.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <span className="text-2xs text-muted-foreground">选中后会覆盖当前主题与正文</span>
                </div>
              ) : null}

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <Label htmlFor="letter-recipient" invalid={Boolean(errors.recipientEmail)}>
                    收件人邮箱
                  </Label>
                  <Input
                    id="letter-recipient"
                    type="email"
                    className="mt-1.5"
                    placeholder="name@company.com"
                    autoComplete="off"
                    invalid={Boolean(errors.recipientEmail)}
                    {...register('recipientEmail')}
                  />
                  <FieldMessage
                    error={errors.recipientEmail?.message}
                    hint={customer?.email ? '默认取客户档案邮箱，可临时修改' : '该客户未填写邮箱，请手动输入收件地址'}
                  />
                </div>

                <div className="sm:col-span-2">
                  <div className="flex items-baseline justify-between gap-2">
                    <Label htmlFor="letter-subject" invalid={Boolean(errors.subject)}>
                      邮件主题
                    </Label>
                    <span className="text-2xs tabular-nums text-muted-foreground">{(subject ?? '').length} / 300</span>
                  </div>
                  <Input
                    id="letter-subject"
                    className="mt-1.5"
                    placeholder="例如：{{company}} packaging — samples from {{moq}}"
                    autoComplete="off"
                    invalid={Boolean(errors.subject)}
                    {...register('subject')}
                  />
                  <FieldMessage error={errors.subject?.message} hint="主题同样支持占位符" />
                </div>
              </div>

              <div>
                <div className="flex items-baseline justify-between gap-2">
                  <Label htmlFor="letter-content">正文</Label>
                  <span className="text-2xs text-muted-foreground">
                    {contentLength > 0 ? `${contentLength.toLocaleString('zh-CN')} 字` : '尚未填写'}
                  </span>
                </div>

                <PlaceholderBar
                  className="mt-1.5"
                  defs={placeholderDefs}
                  values={placeholderValues}
                  onInsert={(def) => insertPlaceholder(def.token)}
                  disabled={sending}
                />

                <div id="letter-content" className="mt-2">
                  <LetterEditor
                    ref={editorRef}
                    value={content ?? ''}
                    onChange={(html) => setValue('content', html, { shouldValidate: true, shouldDirty: true })}
                    onBlur={() => setValue('content', content ?? '', { shouldValidate: true })}
                    placeholder="写信正文…点击上方按钮可插入客户信息占位符"
                    invalid={Boolean(errors.content)}
                    readOnly={sending}
                  />
                </div>
                <FieldMessage error={errors.content?.message} />
              </div>

              {missingLabels.length > 0 ? (
                <p className="flex items-start gap-1.5 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
                  <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                  <span>
                    以下占位符在该客户档案中没有值，发送时会使用兜底文案：
                    <strong className="font-semibold">{missingLabels.join('、')}</strong>
                    。建议先补全客户信息，或从正文中移除它们。
                  </span>
                </p>
              ) : null}

              <Separator />

              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-start gap-2.5">
                  <Switch
                    id="letter-mark-developed"
                    checked={Boolean(markAsDeveloped)}
                    disabled={sending}
                    onCheckedChange={(checked) => setValue('markAsDeveloped', checked)}
                  />
                  <div>
                    <Label htmlFor="letter-mark-developed" className="cursor-pointer text-sm font-medium">
                      发送成功后标记为「已联系」
                    </Label>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      关闭后客户状态保持不变，开发信仍会记入历史记录。
                    </p>
                  </div>
                </div>

                <Badge variant="muted" className="shrink-0">
                  <FileText className="mr-1 h-3 w-3" aria-hidden />
                  {MAIL_CHANNEL_LABEL[channel] ?? channel}
                </Badge>
              </div>
            </TabsContent>

            {/* ---------------- 预览 ---------------- */}
            <TabsContent value="preview" className="space-y-3 pt-1">
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Eye className="h-3.5 w-3.5" aria-hidden />
                这是客户实际会看到的内容（占位符已替换，本地渲染）
              </p>

              <div className="rounded-md border bg-muted/20">
                <div className="space-y-1.5 border-b bg-muted/40 px-4 py-3">
                  <p className="text-xs text-muted-foreground">
                    收件人：<span className="font-medium text-foreground">{recipientEmail || '（未填写）'}</span>
                  </p>
                  <p className="text-sm font-semibold">{preview.subject || '（未填写主题）'}</p>
                </div>

                {preview.html.trim() ? (
                  <div
                    className="mail-preview max-h-[22rem] overflow-y-auto px-4 py-3"
                    // 预览内容来自本地 renderTemplate，取值已做 HTML 转义
                    dangerouslySetInnerHTML={{ __html: preview.html }}
                  />
                ) : (
                  <p className="px-4 py-8 text-center text-sm text-muted-foreground">正文为空</p>
                )}
              </div>
            </TabsContent>
          </Tabs>
        </DialogBody>

        <DialogFooter className="items-center">
          <span className="mr-auto hidden text-2xs text-muted-foreground lg:inline">
            Ctrl/Cmd + Enter 发送 · Ctrl/Cmd + S 存草稿
          </span>
          <Button type="button" variant="ghost" onClick={() => handleOpenChange(false)} disabled={sending}>
            取消
          </Button>
          <Button type="button" variant="outline" onClick={() => void submit(true)} loading={sending} disabled={sending}>
            {!sending ? <Save className="h-3.5 w-3.5" aria-hidden /> : null}
            存草稿
          </Button>
          <Button type="button" onClick={() => void submit(false)} loading={sending} disabled={sending || !customer}>
            {!sending ? <Send className="h-3.5 w-3.5" aria-hidden /> : null}
            {letter ? '重新发送' : '发送开发信'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
