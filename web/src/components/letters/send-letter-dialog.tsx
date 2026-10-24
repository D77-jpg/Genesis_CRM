import {htmlToPlainText, formatDateTime} from '@/lib/format';
import {KnowledgeReviewPanel} from '@/components/agent/knowledge-review';
/**
 * 发送 / 审核开发信弹窗
 * ------------------------------------------------------------------
 * 两条入口共用一套表单：
 *  - 新写开发信：填写主题/正文 → 发送 → 落库 → 刷新历史
 *  - 审核草稿：左侧核对内容，右侧看依据，底部给出「审核通过并发送 / 不通过」
 *
 * 设计要点：
 *  - 正文支持 {{占位符}}，发送时由后端渲染（前端本地预览仅为辅助，最终以后端为准）
 *  - 「预览」页签实时渲染占位符，用户能看到客户真正会收到的内容
 *  - 收件人邮箱可改：客户档案没有邮箱时也能手动指定
 *  - 可选「发送后标记为已联系」，默认开启（与后端默认值一致）
 *  - 支持存草稿；重发时带出原模板
 *  - 草稿审核是业务员对自己草稿的自检，结论落在后端 letter.review（没有理由字段）：
 *    通过后内容指纹一致才允许发送，审核后再次改动正文会回到「需重新审核」，
 *    不通过只记录结论并把草稿移出待处理清单，可一键撤销或改为通过
 */
import * as React from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import {
  CalendarClock,
  Check,
  ChevronRight,
  CircleSlash,
  Eye,
  FileText,
  Info,
  Languages,
  Loader2,
  Mail,
  PencilLine,
  RotateCcw,
  Save,
  Send,
  ShieldCheck,
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
import { apiGet, apiPost, toErrorMessage } from '@/lib/api';
import { createClientId, readStorage, writeStorage } from '@/lib/utils';
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
  appendSignatureHtml,
  withSignatureLogo,
} from '@/constants';
import { useAuthStore } from '@/store/auth.store';
import type { CurrentMailSender, Customer, DevelopmentLetter, LetterReview, SendLetterResult } from '@/types';

export interface SendLetterDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 目标客户；为空时不允许发送 */
  customer: Customer | null;
  /** 重发场景：带出原信的主题与模板 */
  letter?: DevelopmentLetter | null;
  initialDraft?: { analysisId: string; subject: string; content: string } | null;
  /** 发送 / 存草稿成功后回调，父级据此刷新历史列表与客户信息 */
  reply?: { id: string; subject: string; from: string };
  onSent?: (result: SendLetterResult) => void;
  /** 审核结论（通过 / 不通过 / 撤销）写入后回调，父级据此刷新待审核草稿列表 */
  onReviewed?: (letter: DevelopmentLetter) => void;
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

/** 弹窗顶部：收件人与本次发件人并排，省掉单独的发件状态条 */
function RecipientSenderCard({
  customer,
  recipientEmail,
  senderLoading,
  senderAddress,
  canSend,
  activeChannel,
  senderHint,
}: {
  customer: Customer;
  recipientEmail: string;
  senderLoading: boolean;
  senderAddress?: string;
  canSend: boolean;
  activeChannel: string;
  senderHint?: string;
}): React.JSX.Element {
  return (
    <section className="rounded-2xl border border-border/80 bg-card shadow-card">
      <div className="grid gap-3 p-3 sm:grid-cols-2 sm:gap-4">
        <div className="flex min-w-0 items-start gap-2.5">
          <span
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary"
            aria-hidden
          >
            <User className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <p className="flex flex-wrap items-center gap-1.5">
              <span className="text-sm font-semibold">{customer.name}</span>
              <CustomerStatusBadge status={customer.status} />
            </p>
            <p className="truncate text-xs text-muted-foreground">
              {[customer.title, customer.company || '未填写公司', customer.industry].filter(Boolean).join(' · ')}
            </p>
            <p className="mt-1 flex min-w-0 items-center gap-1.5 text-xs">
              <Mail className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
              <span className="truncate" title={recipientEmail}>
                {recipientEmail || '未填写收件邮箱'}
              </span>
            </p>
          </div>
        </div>

        <div className="min-w-0 sm:border-l sm:pl-4">
          <p className="text-xs text-muted-foreground">本次发件人</p>
          <p className="truncate text-sm font-medium" title={senderAddress}>
            {senderLoading ? '正在确认发件邮箱…' : senderAddress || '尚未配置个人发件邮箱'}
          </p>
          <p className="mt-1 flex flex-wrap items-center gap-1.5">
            <Badge variant={canSend ? 'developed' : 'destructive'}>
              <Send className="h-3 w-3" aria-hidden />
              {activeChannel === 'mock' ? '模拟发送' : canSend ? '可发送' : '不可发送'}
            </Badge>
            <span className="text-2xs text-muted-foreground">{MAIL_CHANNEL_LABEL[activeChannel] ?? activeChannel}</span>
          </p>
        </div>
      </div>

      {senderHint ? (
        <p className="flex items-start gap-1.5 border-t bg-amber-500/5 px-3 py-2 text-xs leading-5 text-amber-800 dark:text-amber-300">
          <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          {senderHint}
        </p>
      ) : null}
    </section>
  );
}

/** 审核状态的展示口径：未审核 / 已通过 / 需重新审核 / 已标记不通过（自检结论，不需要理由） */
interface ReviewStatusView {
  label: string;
  variant: 'pending' | 'developed' | 'failed' | 'outline';
  description: string;
}

function reviewStatusView(review: LetterReview | null, dirty: boolean): ReviewStatusView {
  if (review?.decision === 'rejected') {
    return { label: '已标记不通过', variant: 'failed', description: '草稿不会发送给客户，也已从待处理清单移出。想改用的话，点右下角主按钮重新给出结论；也可以撤销标记，回到待审核。' };
  }
  if (review?.decision === 'approved') {
    return dirty
      ? { label: '需重新审核', variant: 'outline', description: '通过后内容又被改动，旧审核已失效，请重新审核后发送。' }
      : { label: '已通过', variant: 'developed', description: `当前内容已通过审核（${formatDateTime(review.at)}），审核后又改动过会失效。` };
  }
  return { label: '待审核', variant: 'pending', description: '自己过一遍：收件人、正文里的交期和承诺没问题就通过并发送；觉得不能用就标记不通过。' };
}

/** 发送结果提示：草稿、定时、失败、模拟通道分别给出可操作文案 */
function notifyLetterResult(result: SendLetterResult, asDraft: boolean): void {
  if (asDraft) {
    toast.success('草稿已保存', { description: result.message || '可在开发信记录中继续编辑发送' });
  } else if (['scheduled', 'queued', 'sending', 'retrying'].includes(result.letter.status)) {
    toast.success('发送任务已保存', { description: result.message });
  } else if (!result.delivered) {
    // 发送失败但已落库：给出可操作提示
    toast.error('发送失败，记录已保存', { description: result.message });
  } else if (result.channel === 'mock') {
    toast.info(result.message || '开发信已记录（模拟发送）', {
      description: `发送方式：${MAIL_CHANNEL_LABEL[result.channel] ?? result.channel}`,
    });
  } else {
    toast.success(result.message || '开发信已发送', { description: `收件人：${result.letter.recipientEmail}` });
  }
}

export function SendLetterDialog({
  open,
  onOpenChange,
  customer,
  letter = null,
  initialDraft = null,
  reply,
  onSent,
  onReviewed,
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
  const bodyRef = React.useRef<HTMLDivElement | null>(null);
  React.useEffect(() => {
    if (!open) return;
    // Reopen must start at the tab bar, not midway through the form.
    const frame = window.requestAnimationFrame(() => bodyRef.current?.scrollTo({ top: 0 }));
    return () => window.cancelAnimationFrame(frame);
  }, [open, letter?.id]);
  const [scheduledAt, setScheduledAt] = React.useState('');
  const [appliedTemplateId, setAppliedTemplateId] = React.useState<string | null>(null);
  const requestKey = React.useRef(createClientId());
  const submitLock = React.useRef(false);
  const [activeTab, setActiveTab] = React.useState<'edit' | 'preview' | 'bilingual'>('edit');
  const [translation, setTranslation] = React.useState<{ subject?: string; body: string } | null>(null);
  const [translationSource, setTranslationSource] = React.useState<string | null>(null);
  const [translating, setTranslating] = React.useState(false);
  const [translationError, setTranslationError] = React.useState<string | null>(null);
  const [serverError, setServerError] = React.useState<string | null>(null);
  const [senderStatus, setSenderStatus] = React.useState<CurrentMailSender | null>(null);
  const [senderLoading, setSenderLoading] = React.useState(false);
  const [senderError, setSenderError] = React.useState<string | null>(null);
  /** 草稿审核结论与「审核时的那份内容」，用于判断通过后又改过东西 */
  const [review, setReview] = React.useState<LetterReview | null>(null);
  const [reviewBaseline, setReviewBaseline] = React.useState<{ subject: string; content: string; recipientEmail: string } | null>(null);
  const [reviewBusy, setReviewBusy] = React.useState(false);
  const reviewLock = React.useRef(false);
  /** 当前登录账号：固定结尾第一行取它的姓名（有个人发件邮箱时优先用邮箱显示名） */
  const authUser = useAuthStore((state) => state.user);

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
    setScheduledAt('');
    setAppliedTemplateId(null);
    requestKey.current = createClientId();

    // 优先级：重发的原信 > 上次使用的模板 > 内置默认模板
    const source = letter
      ? { subject: letter.subject, content: letter.template || letter.content }
      : initialDraft ?? (loadSavedTemplate() ?? { subject: DEFAULT_LETTER_SUBJECT, content: DEFAULT_LETTER_TEMPLATE });

    // 固定结尾直接写进正文，审核时看到的就是客户会收到的完整内容（回复不预填，避免光标落在签名后）
    const signerName = senderStatus?.account?.displayName || authUser?.displayName || '';
    const values: SendLetterFormValues = {
      subject: reply ? (/^re:/i.test(reply.subject) ? reply.subject : 'Re: ' + reply.subject) : source.subject ?? '',
      content: reply ? '' : appendSignatureHtml(source.content ?? '', signerName),
      recipientEmail: reply?.from ?? letter?.recipientEmail ?? customer?.email ?? '',
      // 只有「待开发」客户才需要推进状态，已联系及之后的客户默认关掉更贴合直觉
      markAsDeveloped: customer?.status === 'pending',
      saveAsDraft: false,
    };
    reset(values);

    // 审核结论跟着草稿走；基线取打开时的内容，之后一旦改动就视为「需重新审核」
    setReview(letter?.review ?? null);
    setReviewBaseline(letter ? { subject: values.subject, content: values.content, recipientEmail: values.recipientEmail } : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 仅在「打开 / 客户 / 原信」变化时重建表单
  }, [open, customerId, letterId, initialDraft?.analysisId, reply?.id, reset]);

  React.useEffect(() => {
    if (!open) return;
    let active = true;
    setSenderLoading(true);
    setSenderError(null);
    void apiGet<CurrentMailSender>('/mail-accounts/current')
      .then((result) => { if (active) setSenderStatus(result); })
      .catch((error) => {
        if (!active) return;
        setSenderStatus(null);
        setSenderError(toErrorMessage(error, '无法确认当前发件邮箱'));
      })
      .finally(() => { if (active) setSenderLoading(false); });
    return () => { active = false; };
  }, [open]);

  // 打开时确保模板列表已加载（供「从模板导入」选择器使用；已加载则不重复请求）
  React.useEffect(() => {
    if (open && templateItems.length === 0) void fetchTemplates();
  }, [open, templateItems.length, fetchTemplates]);

  /* ---------------------------- 本地实时预览 ---------------------------- */

  const subject = watch('subject');
  const content = watch('content');
  const recipientEmail = watch('recipientEmail');
  const markAsDeveloped = watch('markAsDeveloped');
  // Attribution is explicit, never reconstructed from matching historical text.
  // Editing the imported copy or a later template update removes the candidate.
  const attributedTemplate = !letter && !reply && appliedTemplateId
    ? templateItems.find((item) => item.id === appliedTemplateId && item.subject === subject && item.content === content)
    : undefined;
  const activeChannel = senderStatus?.channel ?? channel;
  const canSend = senderStatus?.canSend ?? channel === 'mock';

  const placeholderValues = React.useMemo(() => buildPlaceholderValues(customer, company), [customer, company]);

  const debouncedContent = useDebouncedValue(content ?? '', 250);
  const debouncedSubject = useDebouncedValue(subject ?? '', 250);

  const preview = React.useMemo(
    () => ({
      subject: renderTemplate(debouncedSubject, placeholderValues, { escape: false }),
      // 预览里把结尾的 logo 补上（服务端落库/发送时会做同样的事）
      html: withSignatureLogo(renderTemplate(debouncedContent, placeholderValues, { escape: true })),
    }),
    [debouncedSubject, debouncedContent, placeholderValues],
  );

  const englishBody = React.useMemo(() => htmlToPlainText(preview.html), [preview.html]);
  const translationKey = `${preview.subject}\n\n${englishBody}`;
  React.useEffect(() => {
    if (activeTab !== 'bilingual' || !englishBody.trim()) return;
    if (translation && translationSource === translationKey) return;
    let cancelled = false;
    setTranslating(true);
    setTranslationError(null);
    void apiPost<{ subject?: string; body: string }>('/agent/translate', { subject: preview.subject, body: englishBody })
      .then((result) => {
        if (cancelled) return;
        setTranslation(result);
        setTranslationSource(translationKey);
      })
      .catch((error) => {
        if (!cancelled) setTranslationError(toErrorMessage(error, '翻译失败，请稍后重试'));
      })
      .finally(() => { if (!cancelled) setTranslating(false); });
    return () => { cancelled = true; };
  }, [activeTab, englishBody, preview.subject, translationKey, translation, translationSource]);

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

  const isDraftReview = letter?.status === 'draft';
  /** 审核通过后又被编辑（含未保存的本地改动），旧审核即失效 */
  const reviewDirty = Boolean(reviewBaseline) && (
    (subject ?? '') !== reviewBaseline?.subject
    || (content ?? '') !== reviewBaseline?.content
    || (recipientEmail ?? '') !== reviewBaseline?.recipientEmail
  );

  /** 真正落库 + 投递：草稿与新建共用，审核通过后的发送也走这里 */
  const dispatchLetter = React.useCallback(
    (values: SendLetterFormValues, asDraft: boolean): Promise<SendLetterResult> => {
      const scheduledIso = !asDraft && scheduledAt ? new Date(scheduledAt).toISOString() : undefined;
      return letter
        ? resendLetter(letter.id, {
            saveAsDraft: asDraft,
            requestKey: requestKey.current,
            scheduledAt: scheduledIso,
            subject: values.subject,
            content: values.content,
            recipientEmail: values.recipientEmail,
            markAsDeveloped: values.markAsDeveloped,
          })
        : sendLetter({
            customerId: customer!.id,
            // 跟进草稿的 seed 里 analysisId 是空串，这里要收敛成 undefined，
            // 否则后端会当成「无效的 ID」直接 422。
            agentAnalysisId: initialDraft?.analysisId || undefined,
            templateId: attributedTemplate && attributedTemplate.subject === values.subject && attributedTemplate.content === values.content
               ? attributedTemplate.id : undefined,
            requestKey: requestKey.current,
            scheduledAt: scheduledIso,
            replyToId: reply?.id,
            subject: values.subject,
            content: values.content,
            recipientEmail: values.recipientEmail,
            markAsDeveloped: values.markAsDeveloped,
            saveAsDraft: asDraft,
          });
    },
    [letter, customer, initialDraft, reply, attributedTemplate, scheduledAt, sendLetter, resendLetter],
  );

  const submit = React.useCallback(
    async (asDraft: boolean) => {
      if (reply && asDraft) return;
      if (!customer) {
        setServerError('缺少客户信息，无法发送开发信');
        return;
      }

      await handleSubmit(async (values) => {
        if (submitLock.current) return;
        submitLock.current = true;
        setServerError(null);
        try {
          if (!asDraft && !canSend) throw new Error(senderStatus?.reason || senderError || '当前发件邮箱尚未就绪');
          if (!asDraft && scheduledAt && new Date(scheduledAt).getTime() <= Date.now()) throw new Error('定时时间必须晚于当前时间');
          const result = await dispatchLetter(values, asDraft);

          // 记住模板，便于连续发信
          writeStorage(STORAGE_KEYS.lastTemplate, { subject: values.subject, content: values.content });

          if (asDraft) {
            // 内容落库后审核基线随之更新；后端会清掉失效的通过结论
            setReview(result.letter.review ?? null);
            setReviewBaseline({ subject: result.letter.subject, content: values.content, recipientEmail: values.recipientEmail });
          }
          notifyLetterResult(result, asDraft);

          onSent?.(result);
          onOpenChange(false);
        } catch (error) {
          // store 已把后端错误转成中文提示，这里直接展示
          setServerError(toErrorMessage(error, asDraft ? '保存草稿失败' : '开发信发送失败'));
        } finally { submitLock.current = false; }
      })();
    },
    [canSend, customer, dispatchLetter, reply, scheduledAt, senderError, senderStatus?.reason, handleSubmit, onSent, onOpenChange],
  );

  /**
   * 撤销「不通过」标记：只清结论，不改内容，草稿回到待审核。
   * 单独抽出来是因为提示条上的「撤销」可能在弹窗关闭后才点，需要按草稿 id 操作而不是当前打开的那封。
   */
  const clearMark = React.useCallback(
    async (id: string) => {
      try {
        const updated = await apiPost<DevelopmentLetter>(`/letters/${id}/review`, { decision: 'clear' });
        setReview(null);
        toast('已撤销标记', { description: '草稿回到待审核。' });
        onReviewed?.(updated);
      } catch (error) {
        toast.error('撤销标记失败', { description: toErrorMessage(error, '请稍后重试') });
      }
    },
    [onReviewed],
  );

  /**
   * 审核决策（业务员自检自己的草稿，不需要写理由）。
   * 通过：把当前编辑内容一并落库并记录指纹，随后立即发送（发件邮箱未就绪时只记录结论）。
   * 不通过：只记录结论，未保存的编辑不落库；草稿不会发送，也从待处理清单里消失。
   * 撤销：清掉结论，回到待审核。
   */
  const decide = React.useCallback(
    async (decision: 'approve' | 'reject' | 'clear') => {
      if (!letter || !customer) return;
      if (reviewLock.current || submitLock.current) return;

      if (decision !== 'approve') {
        if (decision === 'clear') {
          await clearMark(letter.id);
          return;
        }
        reviewLock.current = true;
        setReviewBusy(true);
        setServerError(null);
        try {
          const updated = await apiPost<DevelopmentLetter>(`/letters/${letter.id}/review`, { decision: 'reject' });
          setReview(updated.review ?? null);
          onReviewed?.(updated);
          const markedId = letter.id;
          toast.success('已标记为不通过', {
            description: '这封草稿不会发送给客户，也不再出现在待处理清单里。',
            action: { label: '撤销标记', onClick: () => void clearMark(markedId) },
          });
          onOpenChange(false);
        } catch (error) {
          setServerError(toErrorMessage(error, '提交审核结论失败'));
        } finally {
          reviewLock.current = false;
          setReviewBusy(false);
        }
        return;
      }

      await handleSubmit(async (values) => {
        if (reviewLock.current) return;
        reviewLock.current = true;
        setReviewBusy(true);
        setServerError(null);
        try {
          const updated = await apiPost<DevelopmentLetter>(`/letters/${letter.id}/review`, {
            decision: 'approve',
            subject: values.subject,
            content: values.content,
            recipientEmail: values.recipientEmail,
          });
          setReview(updated.review ?? null);
          setReviewBaseline({ subject: values.subject, content: values.content, recipientEmail: values.recipientEmail });
          onReviewed?.(updated);

          if (!canSend) {
            toast.success('已审核通过，草稿尚未发送', {
              description: `${senderStatus?.reason || senderError || '个人发件邮箱未就绪'}。邮箱配置好后，打开该草稿点「审核通过并发送」即可。`,
            });
            onOpenChange(false);
            return;
          }
          if (scheduledAt && new Date(scheduledAt).getTime() <= Date.now()) throw new Error('定时时间必须晚于当前时间');

          const result = await dispatchLetter(values, false);
          writeStorage(STORAGE_KEYS.lastTemplate, { subject: values.subject, content: values.content });
          notifyLetterResult(result, false);
          onSent?.(result);
          onOpenChange(false);
        } catch (error) {
          setServerError(toErrorMessage(error, '审核通过后发送失败'));
        } finally {
          reviewLock.current = false;
          setReviewBusy(false);
        }
      })();
    },
    [canSend, clearMark, customer, dispatchLetter, handleSubmit, letter, onOpenChange, onReviewed, onSent, scheduledAt, senderError, senderStatus?.reason],
  );

  /** 已通过且内容没再改动：主按钮就是发送；其余情况主按钮负责「给出通过结论（并发送）」 */
  const reviewApprovedClean = review?.decision === 'approved' && !reviewDirty;
  const needsApprove = isDraftReview && !reviewApprovedClean;

  /** 主按钮：草稿先审核再发送，其他场景直接发送 */
  const primaryAction = React.useCallback(() => {
    if (needsApprove) return decide('approve');
    return submit(false);
  }, [decide, needsApprove, submit]);

  const primaryLabel = isDraftReview
    ? needsApprove
      ? (!canSend ? '审核通过' : '审核通过并发送')
      : scheduledAt
        ? '发送定时任务'
        : '发送开发信'
    : scheduledAt
      ? '保存定时任务'
      : reply
        ? '发送回复'
        : letter && letter.status !== 'draft'
          ? '重新发送'
          : '发送开发信';

  const primaryDisabled = sending || reviewBusy || senderLoading || !customer || (!canSend && !needsApprove);
  const primaryTitle = !canSend
    ? needsApprove
      ? senderStatus?.reason || senderError || '发件邮箱未就绪，本次只记录审核结论'
      : `${senderStatus?.reason || senderError || '发件邮箱未就绪'}；配好邮箱后回到这封草稿点发送即可`
    : undefined;

  const statusView = reviewStatusView(review, reviewDirty);

  // Ctrl/Cmd + S = 存草稿；Ctrl/Cmd + Enter = 发送
  useSaveShortcut(() => {
    if (open && !sending) void submit(true);
  }, open && !sending);

  React.useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
        event.preventDefault();
        void primaryAction();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, primaryAction]);

  const handleOpenChange = React.useCallback(
    (next: boolean) => {
      if (sending || reviewBusy) return;
      onOpenChange(next);
    },
    [sending, reviewBusy, onOpenChange],
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
      setValue('subject', reply ? (/^re:/i.test(reply.subject) ? reply.subject : 'Re: ' + reply.subject) : template.subject ?? '', { shouldValidate: true, shouldDirty: true });
      setValue('content', reply ? (template.content ?? '') : appendSignatureHtml(template.content ?? '', senderStatus?.account?.displayName || authUser?.displayName || ''), { shouldValidate: true, shouldDirty: true });
      setAppliedTemplateId(reply || letter ? null : template.id);
      setActiveTab('edit');
      toast.success('已导入模板', { description: template.name });
    },
    [templateItems, setValue, reply, letter, senderStatus?.account?.displayName, authUser?.displayName],
  );

  const contentLength = (content ?? '').replace(/<[^>]*>/g, '').replace(/&nbsp;/gi, ' ').trim().length;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="max-w-6xl"
        // 审核时是"读信 + 看检查项"，别一进来就把光标塞进收件人输入框
        onOpenAutoFocus={(event) => {
          if (isDraftReview) event.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {isDraftReview ? <ShieldCheck className="h-4 w-4 text-primary" aria-hidden /> : <Send className="h-4 w-4 text-primary" aria-hidden />}
            {reply ? '回复客户邮件' : isDraftReview ? '审核开发信草稿' : letter ? '重新发送开发信' : '发送开发信'}
          </DialogTitle>
          <DialogDescription>
            {isDraftReview
              ? '左侧核对要发给客户的内容，右侧列出需要你确认的事；没问题就通过并发送，觉得不能用直接标记不通过（不用写理由）。'
              : letter
                ? '已带出原信内容，可修改后再次发送；会新增一条发送记录。'
                : '正文中的 {{占位符}} 会在发送时自动替换为该客户的真实信息。'}
          </DialogDescription>
        </DialogHeader>

        <DialogBody ref={bodyRef} className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_21rem]">
          {/* ---------------- 左栏：核对要发给客户的内容 ---------------- */}
          <div className="min-w-0 space-y-4">
            {customer ? (
              <RecipientSenderCard
                customer={customer}
                recipientEmail={recipientEmail || customer.email || ''}
                senderLoading={senderLoading}
                senderAddress={senderStatus?.senderAddress}
                canSend={canSend}
                activeChannel={activeChannel}
                senderHint={!senderLoading && (!canSend || senderError)
                  ? `${senderStatus?.reason || senderError || '个人发件邮箱尚未就绪'}。仍可存草稿并给出审核结论，发送前请联系管理员配置并验证邮箱。`
                  : undefined}
              />
            ) : null}

            {serverError ? (
              <Alert variant="destructive">
                <TriangleAlert aria-hidden />
                <AlertTitle>操作未完成</AlertTitle>
                <AlertDescription>{serverError}</AlertDescription>
              </Alert>
            ) : null}

            {activeChannel === 'mock' ? (
              <Alert variant="warning">
                <Info aria-hidden />
                <AlertDescription>
                  当前为{MAIL_CHANNEL_LABEL.mock}模式：开发信会完整保存到该客户的记录中，但不会真正投递邮件。
                </AlertDescription>
              </Alert>
            ) : null}

            {/* ---------------- 邮件内容：编辑 / 预览 / 中英对照 ---------------- */}
            <section className="min-w-0 rounded-2xl border border-border/80 bg-card shadow-card">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-muted/30 px-3 py-2">
                <h3 className="flex items-center gap-1.5 text-sm font-semibold">
                  <FileText className="h-4 w-4 text-muted-foreground" aria-hidden />
                  邮件内容
                </h3>
                <div className="flex items-center gap-2">
                  {isDraftReview ? <Badge variant="muted">未发送草稿</Badge> : null}
                  <span className="text-2xs tabular-nums text-muted-foreground">
                    {contentLength > 0 ? `${contentLength.toLocaleString('zh-CN')} 字` : '尚未填写正文'}
                  </span>
                </div>
              </div>
              <div className="space-y-4 p-3">
                {templateItems.length > 0 ? (
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 rounded-md border border-dashed bg-muted/20 px-3 py-2">
                  <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="text-xs text-muted-foreground">从模板导入</span>
                  <Select value={TEMPLATE_PICK_NONE} onValueChange={handleApplyTemplate}>
                    <SelectTrigger className="h-7 w-auto min-w-[9rem] max-w-full text-xs" aria-label="选择模板">
                      <SelectValue placeholder="选择模板…">选择模板…</SelectValue>
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
                    readOnly={!!reply}
                  />
                  <FieldMessage
                    error={errors.recipientEmail?.message}
                    hint={reply ? '回复地址取原邮件发件人' : customer?.email ? '默认取客户档案邮箱，可临时修改' : '该客户未填写邮箱，请手动输入收件地址'}
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
                    readOnly={!!reply}
                  />
                  <FieldMessage error={errors.subject?.message} hint={reply ? '回复主题沿用原邮件会话，不能修改' : '主题同样支持占位符'} />
                </div>
              </div>

                <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as 'edit' | 'preview' | 'bilingual')}>
                  <TabsList className="h-9 justify-start gap-1 bg-muted/60">
                    <TabsTrigger value="edit">
                      <PencilLine className="h-3.5 w-3.5" aria-hidden />
                      编辑
                    </TabsTrigger>
                    <TabsTrigger value="preview">
                      <Eye className="h-3.5 w-3.5" aria-hidden />
                      预览
                    </TabsTrigger>
                    <TabsTrigger value="bilingual">
                      <Languages className="h-3.5 w-3.5" aria-hidden />
                      中英对照
                    </TabsTrigger>
                  </TabsList>
                  <TabsContent value="edit" className="space-y-4 pt-1">
                    <div>
                      <Label htmlFor="letter-content">正文</Label>

                      <details className="group mt-1.5 rounded-md border border-dashed bg-muted/20">
                        <summary className="flex min-h-9 cursor-pointer list-none items-center gap-1.5 px-2.5 py-1.5 text-xs text-muted-foreground">
                          <ChevronRight className="h-3.5 w-3.5 shrink-0 transition-transform group-open:rotate-90" aria-hidden />
                          插入客户信息占位符（发送时自动替换成真实内容）
                        </summary>
                        <PlaceholderBar
                          className="border-0 bg-transparent"
                          defs={placeholderDefs}
                          values={placeholderValues}
                          onInsert={(def) => insertPlaceholder(def.token)}
                          disabled={sending}
                        />
                      </details>

                      <div id="letter-content" className="mt-2">
                        <LetterEditor
                          ref={editorRef}
                          className={isDraftReview ? 'min-h-[26rem]' : undefined}
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

                    <p className="text-2xs leading-5 text-muted-foreground">
                      定时发送与「发送后标记为已联系」在右侧「发送设置」中调整。
                    </p>
                  </TabsContent>

                  {/* ---------------- 预览 ---------------- */}
                  <TabsContent value="preview" className="space-y-3 pt-1">
                    <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Eye className="h-3.5 w-3.5" aria-hidden />
                      邮件预览（已填入客户资料）
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

                  {/* ---------------- 中英对照 ---------------- */}
                  <TabsContent value="bilingual" className="space-y-3 pt-1">
                    <div className="grid gap-3 lg:grid-cols-2">
                      <section className="min-w-0 rounded-xl border border-border/80 bg-card">
                        <div className="flex items-center justify-between border-b bg-muted/40 px-4 py-2">
                          <span className="text-xs font-medium text-muted-foreground">English（原文）</span>
                          <span className="text-2xs text-muted-foreground">实际发送</span>
                        </div>
                        <div className="max-h-[24rem] space-y-2 overflow-y-auto px-4 py-3 text-sm leading-6">
                          <p className="font-semibold">{preview.subject || '（未填写主题）'}</p>
                          {englishBody.trim()
                            ? <p className="whitespace-pre-wrap break-words">{englishBody}</p>
                            : <p className="py-6 text-center text-muted-foreground">正文为空</p>}
                        </div>
                      </section>
                      <section className="min-w-0 rounded-md border bg-muted/20">
                        <div className="flex items-center justify-between border-b bg-muted/40 px-4 py-2">
                          <span className="text-xs font-medium text-muted-foreground">中文对照</span>
                          {translating ? (
                            <span className="flex items-center gap-1.5 text-2xs text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" aria-hidden />正在翻译…</span>
                          ) : translation ? (
                            <span className="text-2xs text-muted-foreground">仅用于核对</span>
                          ) : null}
                        </div>
                        <div className="max-h-[24rem] space-y-2 overflow-y-auto px-4 py-3 text-sm leading-6">
                          {translationError ? (
                            <div className="space-y-2 py-4 text-center">
                              <p className="text-sm text-destructive">{translationError}</p>
                              <Button type="button" variant="outline" size="sm" onClick={() => { setTranslation(null); setTranslationSource(null); }}>重新翻译</Button>
                            </div>
                          ) : translation ? (
                            <>
                              <p className="font-semibold">{translation.subject || '（主题未翻译）'}</p>
                              <p className="whitespace-pre-wrap break-words">{translation.body}</p>
                            </>
                          ) : translating ? (
                            <div className="space-y-2 py-4"><div className="h-4 w-3/4 animate-pulse rounded bg-muted" /><div className="h-4 w-full animate-pulse rounded bg-muted" /><div className="h-4 w-5/6 animate-pulse rounded bg-muted" /></div>
                          ) : (
                            <p className="py-6 text-center text-muted-foreground">{englishBody.trim() ? '打开后会自动翻译' : '正文为空'}</p>
                          )}
                        </div>
                      </section>
                    </div>
                    <p className="text-2xs text-muted-foreground">翻译只用于核对内容，实际发送的是左侧英文原文；翻译不会修改草稿。</p>
                  </TabsContent>
                </Tabs>
              </div>
              </section>
          </div>

          {/* ---------------- 右栏：依据核对 → 审核结论 → 发送设置 ---------------- */}
          <aside className="min-w-0 space-y-4 lg:sticky lg:top-0">
            {isDraftReview ? (
              <section className="rounded-2xl border border-border/80 bg-card shadow-card">
                <div className="flex items-center justify-between gap-2 border-b bg-muted/30 px-3 py-2">
                  <h3 className="flex items-center gap-1.5 text-sm font-semibold">
                    <ShieldCheck className="h-4 w-4 text-primary" aria-hidden />
                    审核结论
                  </h3>
                  <Badge variant={statusView.variant}>{statusView.label}</Badge>
                </div>
                <div className="space-y-2 p-3">
                  <p className="text-xs leading-5 text-muted-foreground">{statusView.description}</p>
                  <p className="text-2xs leading-5 text-muted-foreground">
                    通过后才会真正发给客户；标记不通过不会发送。签名和 logo 已在正文末尾，可直接核对。
                  </p>
                </div>
              </section>
            ) : null}

            <section className="rounded-2xl border border-border/80 bg-card shadow-card p-3">
              <KnowledgeReviewPanel
                letterId={letter?.id}
                analysisId={initialDraft?.analysisId}
                currentBody={htmlToPlainText(content ?? '')}
                currentSubject={subject}
              />
            </section>

            <section className="rounded-2xl border border-border/80 bg-card shadow-card p-3">
              <h3 className="flex items-center gap-1.5 text-sm font-semibold">
                <CalendarClock className="h-4 w-4 text-muted-foreground" aria-hidden />
                发送设置
              </h3>
              <div className="mt-2.5 space-y-1">
                <Label htmlFor="scheduled-mail-at" className="text-xs font-normal text-muted-foreground">定时发送（可选）</Label>
                <Input
                  id="scheduled-mail-at"
                  type="datetime-local"
                  className="h-9"
                  value={scheduledAt}
                  onChange={(e) => setScheduledAt(e.target.value)}
                  disabled={sending || reviewBusy}
                />
                <p className="text-2xs leading-5 text-muted-foreground">
                  {scheduledAt ? `将在 ${formatDateTime(scheduledAt)} 发送（本地时间）` : '留空表示通过后立即发送。'}
                </p>
              </div>

              <Separator className="my-3" />

              <div className="flex items-start gap-2.5">
                <Switch
                  id="letter-mark-developed"
                  className="mt-0.5"
                  checked={Boolean(markAsDeveloped)}
                  disabled={sending || reviewBusy}
                  onCheckedChange={(checked) => setValue('markAsDeveloped', checked)}
                />
                <div className="min-w-0">
                  <Label htmlFor="letter-mark-developed" className="cursor-pointer text-sm font-medium">
                    发送成功后标记为「已联系」
                  </Label>
                  <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
                    关闭后客户状态保持不变，开发信仍会记入历史。发送方式：{MAIL_CHANNEL_LABEL[activeChannel] ?? activeChannel}。
                  </p>
                </div>
              </div>
            </section>
          </aside>
        </DialogBody>

        <DialogFooter className="items-center">
          <span className="mr-auto hidden text-2xs text-muted-foreground lg:inline">
            {isDraftReview
              ? `Ctrl/Cmd + Enter ${primaryLabel} · Ctrl/Cmd + S 存草稿`
              : reply
                ? 'Ctrl/Cmd + Enter 发送回复'
                : 'Ctrl/Cmd + Enter 发送 · Ctrl/Cmd + S 存草稿'}
          </span>
          <Button type="button" variant="ghost" onClick={() => handleOpenChange(false)} disabled={sending || reviewBusy}>
            取消
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => void submit(true)}
            loading={sending}
            disabled={sending || !!reply || reviewBusy}
            title={reply ? '回复邮件暂不支持存草稿' : undefined}
            aria-describedby={reply ? 'reply-draft-help' : undefined}
          >
            {!sending ? <Save className="h-3.5 w-3.5" aria-hidden /> : null}
            存草稿
          </Button>
          {reply ? <span id="reply-draft-help" className="sr-only">回复邮件暂不支持存草稿。</span> : null}

          {isDraftReview ? (
            review?.decision === 'rejected' ? (
              <Button
                type="button"
                variant="ghost"
                className="text-muted-foreground"
                onClick={() => void decide('clear')}
                disabled={sending || reviewBusy}
                title="清掉不通过标记，草稿回到待审核"
              >
                {!reviewBusy ? <RotateCcw className="h-3.5 w-3.5" aria-hidden /> : null}
                撤销标记
              </Button>
            ) : (
              <Button
                type="button"
                variant="outline"
                onClick={() => void decide('reject')}
                disabled={sending || reviewBusy}
                title="这封草稿不发给客户；不用写理由，随时可以撤销或改为通过"
              >
                {!reviewBusy ? <CircleSlash className="h-3.5 w-3.5" aria-hidden /> : null}
                不通过
              </Button>
            )
          ) : null}

          <Button
            type="button"
            onClick={() => void primaryAction()}
            loading={sending || reviewBusy}
            disabled={primaryDisabled}
            title={primaryTitle}
          >
            {!sending && !reviewBusy ? (
              isDraftReview ? <Check className="h-3.5 w-3.5" aria-hidden /> : <Send className="h-3.5 w-3.5" aria-hidden />
            ) : null}
            {primaryLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
