/**
 * 客户详情页
 * ------------------------------------------------------------------
 * 上半部分是客户完整档案，下半部分是该客户的开发信历史（产品主流程入口）。
 * URL 带 #letters 时自动滚动到历史区（从列表页「开发信数」徽章点进来）。
 */
import * as React from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import {
  BadgeDollarSign,
  Boxes,
  Building2,
  CalendarClock,
  Contact,
  Facebook,
  Flag,
  FolderTree,
  Globe,
  Hash,
  Instagram,
  Layers,
  Linkedin,
  Mail,
  MapPin,
  MessageCircle,
  MessageSquare,
  MessageSquareText,
  NotebookText,
  Package,
  Pencil,
  Phone,
  Send,
  Star,
  Tag,
  Trash2,
  TriangleAlert,
  User,
} from 'lucide-react';
import { PageHeader } from '@/components/common/page-header';
import { ConfirmDialog } from '@/components/common/confirm-dialog';
import { ErrorState, InlineLoader } from '@/components/common/empty-state';
import { CustomerStatusBadge } from '@/components/common/status-badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator, Skeleton } from '@/components/ui/separator';
import { CustomerFormDialog } from '@/components/customers/customer-form-dialog';
import { CustomerActivity } from '@/components/customers/customer-activity';
import { CustomerAttachments } from '@/components/customers/customer-attachments';
import { SendLetterDialog } from '@/components/letters/send-letter-dialog';
import { LetterViewDialog } from '@/components/letters/letter-view-dialog';
import { LetterHistoryTable } from '@/components/letters/letter-history-table';
import { useCustomer, useCustomerLetters, useIndustries, useOwners } from '@/hooks/use-queries';
import { usePageTitle } from '@/hooks/use-ui';
import { useCustomerStore } from '@/store/customer.store';
import { selectIsAdmin, useAuthStore } from '@/store/auth.store';
import { useLetterStore } from '@/store/letter.store';
import { formatDate, formatDateTime, formatRelative, getFollowUpState, initials } from '@/lib/format';
import { cn } from '@/lib/utils';
import {
  CUSTOMER_PRIORITY_BADGE_CLASS,
  CUSTOMER_PRIORITY_LABEL,
  DEFAULT_PAGE_SIZE,
  ROUTES,
} from '@/constants';
import type { Customer, DevelopmentLetter } from '@/types';

/** 档案里的一行：图标 + 标签 + 值，值为空时显示占位符 */
function InfoRow({
  icon,
  label,
  value,
  href,
  className,
}: {
  icon: React.ReactNode;
  label: string;
  value?: string | null;
  href?: string;
  className?: string;
}): React.JSX.Element {
  const empty = !value;
  return (
    <div className={className}>
      <dt className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <span className="shrink-0" aria-hidden>
          {icon}
        </span>
        {label}
      </dt>
      <dd className="mt-1 break-words text-sm font-medium">
        {empty ? (
          <span className="font-normal text-muted-foreground">未填写</span>
        ) : href ? (
          <a
            href={href}
            target={href.startsWith('http') ? '_blank' : undefined}
            rel={href.startsWith('http') ? 'noreferrer noopener' : undefined}
            className="text-primary underline-offset-2 hover:underline"
          >
            {value}
          </a>
        ) : (
          value
        )}
      </dd>
    </div>
  );
}

/**
 * 联系字段的点击链接：
 * - 完整 URL（http/https）直接用；
 * - WhatsApp 号码（≥ 6 位数字）拼成 https://wa.me/<digits>；
 * - 其余只有用户名 / ID 的情况不强行拼接，避免生成错误链接（返回 undefined → 纯文本）。
 */
function contactHref(kind: 'whatsapp' | 'social', value?: string | null): string | undefined {
  const raw = value?.trim();
  if (!raw) return undefined;
  if (/^https?:\/\//i.test(raw)) return raw;
  if (kind === 'whatsapp') {
    const digits = raw.replace(/\D/g, '');
    if (digits.length >= 6) return `https://wa.me/${digits}`;
  }
  return undefined;
}

export function CustomerDetailPage(): React.JSX.Element {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const lettersAnchor = React.useRef<HTMLDivElement | null>(null);

  const { data: customer, loading, error, run: reloadCustomer } = useCustomer(id);
  usePageTitle(customer?.name ?? '客户详情');

  // 严格分配制：负责人字段仅管理员可见
  const isAdmin = useAuthStore(selectIsAdmin);

  // 编辑弹窗的行业 / 负责人候选，与列表页共用同一份 store 数据
  useIndustries();
  useOwners();
  const industries = useCustomerStore((state) => state.industries);
  const owners = useCustomerStore((state) => state.owners);
  const patchLocal = useCustomerStore((state) => state.patchLocal);
  const deleteCustomer = useCustomerStore((state) => state.deleteCustomer);
  const customerMutating = useCustomerStore((state) => state.mutating);

  const deleteLetter = useLetterStore((state) => state.deleteLetter);
  const letterBusy = useLetterStore((state) => state.sending);

  /* ---------------------------- 开发信分页（页面私有状态） ---------------------------- */

  const [letterPage, setLetterPage] = React.useState(1);
  const [letterLimit, setLetterLimit] = React.useState(DEFAULT_PAGE_SIZE);

  const lettersQuery = useCustomerLetters(id, { page: letterPage, limit: letterLimit });
  // run 引用稳定，单独取出来放进依赖，避免每次渲染都重建回调
  const reloadLetters = lettersQuery.run;

  /* ---------------------------- 弹窗状态 ---------------------------- */

  const [editOpen, setEditOpen] = React.useState(false);
  const [sendOpen, setSendOpen] = React.useState(false);
  const [resendTarget, setResendTarget] = React.useState<DevelopmentLetter | null>(null);
  const [viewTarget, setViewTarget] = React.useState<DevelopmentLetter | null>(null);
  const [viewOpen, setViewOpen] = React.useState(false);
  const [deleteLetterTarget, setDeleteLetterTarget] = React.useState<DevelopmentLetter | null>(null);
  const [deleteCustomerOpen, setDeleteCustomerOpen] = React.useState(false);

  /** 发信 / 重发成功后：刷新客户档案与开发信历史 */
  const refreshAll = React.useCallback(async () => {
    await Promise.all([reloadCustomer(), reloadLetters()]);
  }, [reloadCustomer, reloadLetters]);

  // 发信结果里带了最新的 customer，可先局部更新列表缓存，返回时不闪烁
  const handleSent = React.useCallback(
    (result: { customer: Customer }) => {
      if (id && result.customer) patchLocal(id, result.customer);
      void refreshAll();
    },
    [id, patchLocal, refreshAll],
  );

  /* ---------------------------- #letters 锚点 ---------------------------- */

  const hash = location.hash;
  React.useEffect(() => {
    if (hash !== '#letters' || loading || !customer) return;
    // 等表格渲染完再滚，否则位置会偏
    const timer = window.setTimeout(() => {
      lettersAnchor.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 120);
    return () => window.clearTimeout(timer);
  }, [hash, loading, customer]);

  /* ---------------------------- 动作 ---------------------------- */

  const openResend = React.useCallback((letter: DevelopmentLetter) => {
    setViewOpen(false);
    setResendTarget(letter);
    setSendOpen(true);
  }, []);

  const confirmDeleteLetter = React.useCallback(async () => {
    if (!deleteLetterTarget) return;
    try {
      await deleteLetter(deleteLetterTarget.id);
      toast.success('开发信记录已删除');
      setDeleteLetterTarget(null);
      setViewOpen(false);
      await Promise.all([reloadCustomer(), reloadLetters()]);
    } catch (caught) {
      toast.error('删除失败', { description: caught instanceof Error ? caught.message : String(caught) });
    }
  }, [deleteLetterTarget, deleteLetter, reloadCustomer, reloadLetters]);

  const confirmDeleteCustomer = React.useCallback(async () => {
    if (!id) return;
    try {
      await deleteCustomer(id);
      toast.success('客户已删除', { description: '相关的开发信记录也一并清理' });
      setDeleteCustomerOpen(false);
      navigate(ROUTES.customers, { replace: true });
    } catch (caught) {
      toast.error('删除失败', { description: caught instanceof Error ? caught.message : String(caught) });
    }
  }, [id, deleteCustomer, navigate]);

  /* ---------------------------- 渲染分支 ---------------------------- */

  if (loading && !customer) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-9 w-56" />
        <Card>
          <CardContent className="p-5">
            <InlineLoader label="正在加载客户信息…" />
          </CardContent>
        </Card>
      </div>
    );
  }

  if (error || !customer) {
    return (
      <div className="space-y-4">
        <PageHeader title="客户详情" backTo={ROUTES.customers} backLabel="返回客户列表" />
        <Card>
          <ErrorState
            title="客户不存在或已被删除"
            description={error ?? '请返回列表重新选择一位客户'}
            onRetry={() => {
              if (id) void reloadCustomer();
              else navigate(ROUTES.customers);
            }}
            retrying={loading}
          />
        </Card>
      </div>
    );
  }

  const letters = lettersQuery.data?.items ?? [];
  const letterTotal = lettersQuery.data?.total ?? 0;
  const letterTotalPages = lettersQuery.data?.totalPages ?? 0;

  return (
    <div className="space-y-4">
      <PageHeader
        backTo={ROUTES.customers}
        backLabel="返回客户列表"
        title={
          <span className="flex items-center gap-2.5">
            <span
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary"
              aria-hidden
            >
              {initials(customer.name)}
            </span>
            <span className="min-w-0 truncate">{customer.name}</span>
            <CustomerStatusBadge status={customer.status} className="hidden sm:inline-flex" />
          </span>
        }
        description={
          <>
            {customer.company || '未填写公司'}
            {customer.title ? ` · ${customer.title}` : ''}
            {customer.industry ? ` · ${customer.industry}` : ''}
          </>
        }
        actions={
          <>
            <Button type="button" variant="outline" size="sm" onClick={() => setEditOpen(true)}>
              <Pencil className="h-4 w-4" aria-hidden />
              编辑信息
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="text-destructive hover:bg-destructive/10 hover:text-destructive"
              onClick={() => setDeleteCustomerOpen(true)}
            >
              <Trash2 className="h-4 w-4" aria-hidden />
              删除
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={() => {
                setResendTarget(null);
                setSendOpen(true);
              }}
            >
              <Send className="h-4 w-4" aria-hidden />
              发送开发信
            </Button>
          </>
        }
      />

      {/* ---------------------------- 客户档案 ---------------------------- */}

      <Card>
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0">
          <div>
            <CardTitle className="flex items-center gap-2">
              <User className="h-4 w-4 text-muted-foreground" aria-hidden />
              客户信息
            </CardTitle>
            <CardDescription>
              来源：{customer.leadSource?.trim() ? customer.leadSource : '未设置'} · 创建于 {formatDateTime(customer.createdAt)}
            </CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary" className="gap-1.5">
              <MessageSquareText className="h-3 w-3" aria-hidden />
              开发信 {customer.letterCount} 封
            </Badge>
            {customer.grade ? (
              <Badge variant="secondary" className="gap-1.5">
                <Star className="h-3 w-3" aria-hidden />
                等级 {customer.grade}
              </Badge>
            ) : null}
            {customer.priority ? (
              <Badge variant="outline" className={cn('gap-1.5', CUSTOMER_PRIORITY_BADGE_CLASS[customer.priority])}>
                <Flag className="h-3 w-3" aria-hidden />
                优先级 {CUSTOMER_PRIORITY_LABEL[customer.priority]}
              </Badge>
            ) : null}
            <Badge variant="muted" className="gap-1.5">
              <CalendarClock className="h-3 w-3" aria-hidden />
              {customer.lastContactAt ? `最近联系 ${formatRelative(customer.lastContactAt)}` : '尚未联系'}
            </Badge>
          </div>
        </CardHeader>

        <CardContent>
          {getFollowUpState(customer.nextFollowUpAt) === 'overdue' ? (
            <div className="mb-4 flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <span>该客户的下一次跟进时间（{formatDate(customer.nextFollowUpAt)}）已逾期，请尽快联系。</span>
            </div>
          ) : null}
          <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
            <InfoRow icon={<Building2 className="h-3.5 w-3.5" />} label="公司" value={customer.company} />
            <InfoRow
              icon={<Mail className="h-3.5 w-3.5" />}
              label="邮箱"
              value={customer.email}
              href={customer.email ? `mailto:${customer.email}` : undefined}
            />
            <InfoRow
              icon={<Phone className="h-3.5 w-3.5" />}
              label="手机号"
              value={customer.phone}
              href={customer.phone ? `tel:${customer.phone}` : undefined}
            />
            <InfoRow icon={<User className="h-3.5 w-3.5" />} label="职位" value={customer.title} />
            <InfoRow icon={<Building2 className="h-3.5 w-3.5" />} label="行业" value={customer.industry} />
            <InfoRow icon={<Globe className="h-3.5 w-3.5" />} label="国家 / 地区" value={customer.country} />
            <InfoRow
              icon={<Globe className="h-3.5 w-3.5" />}
              label="官网"
              value={customer.website}
              href={
                customer.website
                  ? customer.website.startsWith('http')
                    ? customer.website
                    : `https://${customer.website}`
                  : undefined
              }
            />
            <InfoRow icon={<MapPin className="h-3.5 w-3.5" />} label="地址" value={customer.address} className="sm:col-span-2" />
            <InfoRow icon={<CalendarClock className="h-3.5 w-3.5" />} label="更新时间" value={formatDateTime(customer.updatedAt)} />
            {isAdmin ? (
              <InfoRow icon={<User className="h-3.5 w-3.5" />} label="负责人" value={customer.owner?.name ?? null} />
            ) : null}
            <InfoRow
              icon={<CalendarClock className="h-3.5 w-3.5" />}
              label="下一次跟进"
              value={customer.nextFollowUpAt ? formatDate(customer.nextFollowUpAt) : null}
            />
          </dl>

          {customer.tags.length > 0 ? (
            <div className="mt-4">
              <p className="text-xs text-muted-foreground">标签</p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {customer.tags.map((tag) => (
                  <Badge key={tag} variant="outline" className="font-normal">
                    {tag}
                  </Badge>
                ))}
              </div>
            </div>
          ) : null}

          {customer.notes ? (
            <>
              <Separator className="my-4" />
              <div>
                <p className="text-xs text-muted-foreground">备注</p>
                <p className="mt-1.5 whitespace-pre-wrap rounded-md bg-muted/40 p-3 text-sm leading-relaxed">
                  {customer.notes}
                </p>
              </div>
            </>
          ) : null}

          {!customer.email ? (
            <p className="mt-4 rounded-md border border-status-pending/30 bg-status-pending/5 px-3 py-2 text-xs text-status-pending">
              该客户还没有邮箱，发送开发信时需要在弹窗里手动填写收件人地址。
            </p>
          ) : null}
        </CardContent>
      </Card>

      {/* ---------------------------- 联系方式 ---------------------------- */}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Contact className="h-4 w-4 text-muted-foreground" aria-hidden />
            联系方式
          </CardTitle>
          <CardDescription>邮件、电话与社交渠道，完整链接可直接点击发起联系</CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
            <InfoRow
              icon={<Mail className="h-3.5 w-3.5" />}
              label="Email"
              value={customer.email}
              href={customer.email ? `mailto:${customer.email}` : undefined}
            />
            <InfoRow
              icon={<Phone className="h-3.5 w-3.5" />}
              label="Phone"
              value={customer.phone}
              href={customer.phone ? `tel:${customer.phone}` : undefined}
            />
            <InfoRow
              icon={<MessageCircle className="h-3.5 w-3.5" />}
              label="WhatsApp"
              value={customer.whatsapp}
              href={contactHref('whatsapp', customer.whatsapp)}
            />
            <InfoRow icon={<MessageSquare className="h-3.5 w-3.5" />} label="Skype" value={customer.skype} />
            <InfoRow
              icon={<Linkedin className="h-3.5 w-3.5" />}
              label="LinkedIn"
              value={customer.linkedin}
              href={contactHref('social', customer.linkedin)}
            />
            <InfoRow
              icon={<Facebook className="h-3.5 w-3.5" />}
              label="Facebook"
              value={customer.facebook}
              href={contactHref('social', customer.facebook)}
            />
            <InfoRow
              icon={<Instagram className="h-3.5 w-3.5" />}
              label="Instagram"
              value={customer.instagram}
              href={contactHref('social', customer.instagram)}
            />
          </dl>
        </CardContent>
      </Card>

      {/* ---------------------------- 客户需求 ---------------------------- */}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Package className="h-4 w-4 text-muted-foreground" aria-hidden />
            客户需求
          </CardTitle>
          <CardDescription>客户到底想买什么：产品、型号、分类、数量、目标价与 MOQ</CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
            <InfoRow icon={<Boxes className="h-3.5 w-3.5" />} label="感兴趣产品" value={customer.interestedProducts} />
            <InfoRow icon={<Tag className="h-3.5 w-3.5" />} label="产品型号" value={customer.productModel} />
            <InfoRow icon={<FolderTree className="h-3.5 w-3.5" />} label="产品分类" value={customer.productCategory} />
            <InfoRow icon={<Hash className="h-3.5 w-3.5" />} label="预计采购数量" value={customer.expectedQuantity} />
            <InfoRow icon={<BadgeDollarSign className="h-3.5 w-3.5" />} label="目标价格" value={customer.targetPrice} />
            <InfoRow icon={<Layers className="h-3.5 w-3.5" />} label="MOQ" value={customer.moq} />
          </dl>

          {customer.requirementNotes ? (
            <div className="mt-4">
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <NotebookText className="h-3.5 w-3.5" aria-hidden />
                需求备注
              </p>
              <p className="mt-1.5 whitespace-pre-wrap rounded-md bg-muted/40 p-3 text-sm leading-relaxed">
                {customer.requirementNotes}
              </p>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {/* ---------------------------- 跟进记录 / 客户动态 ---------------------------- */}

      <CustomerActivity customerId={customer.id} onCustomerChanged={() => void reloadCustomer()} />

      {/* ---------------------------- 开发信历史 ---------------------------- */}

      <div ref={lettersAnchor} id="letters" className="scroll-mt-20">
        <Card>
          <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0">
            <div>
              <CardTitle className="flex items-center gap-2">
                <MessageSquareText className="h-4 w-4 text-muted-foreground" aria-hidden />
                开发信记录
              </CardTitle>
              <CardDescription>
                {letterTotal > 0
                  ? `共 ${letterTotal.toLocaleString('zh-CN')} 条，每次发送都会自动留档`
                  : '发送后的开发信会同步记录在这里'}
              </CardDescription>
            </div>
            <Button
              type="button"
              size="sm"
              onClick={() => {
                setResendTarget(null);
                setSendOpen(true);
              }}
            >
              <Send className="h-4 w-4" aria-hidden />
              发送开发信
            </Button>
          </CardHeader>

          <LetterHistoryTable
            letters={letters}
            loading={lettersQuery.loading}
            error={lettersQuery.error}
            page={letterPage}
            limit={letterLimit}
            total={letterTotal}
            totalPages={letterTotalPages}
            onPageChange={setLetterPage}
            onLimitChange={(next) => {
              setLetterLimit(next);
              setLetterPage(1);
            }}
            onView={(letter) => {
              setViewTarget(letter);
              setViewOpen(true);
            }}
            onResend={openResend}
            onDelete={setDeleteLetterTarget}
            onRetry={() => void reloadLetters()}
            onSendFirst={() => {
              setResendTarget(null);
              setSendOpen(true);
            }}
            busy={letterBusy}
          />
        </Card>
      </div>

      {/* ---------------------------- 客户附件 ---------------------------- */}

      <CustomerAttachments customerId={customer.id} />

      {/* ---------------------------- 弹窗 ---------------------------- */}

      <CustomerFormDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        customer={customer}
        industries={industries}
        owners={owners}
        onSaved={() => void reloadCustomer()}
      />

      <SendLetterDialog
        open={sendOpen}
        onOpenChange={(open) => {
          setSendOpen(open);
          if (!open) setResendTarget(null);
        }}
        customer={customer}
        letter={resendTarget}
        onSent={handleSent}
      />

      <LetterViewDialog
        open={viewOpen}
        onOpenChange={(open) => {
          setViewOpen(open);
          if (!open) setViewTarget(null);
        }}
        letter={viewTarget}
        onResend={openResend}
        onDelete={setDeleteLetterTarget}
      />

      <ConfirmDialog
        open={Boolean(deleteLetterTarget)}
        onOpenChange={(open) => !open && setDeleteLetterTarget(null)}
        title="删除开发信记录"
        description={
          deleteLetterTarget
            ? `确定要删除「${deleteLetterTarget.subject || '（无主题）'}」这条记录吗？删除后无法恢复，客户的开发信数量会同步减少。`
            : undefined
        }
        confirmText="删除"
        variant="destructive"
        loading={letterBusy}
        onConfirm={confirmDeleteLetter}
      />

      <ConfirmDialog
        open={deleteCustomerOpen}
        onOpenChange={setDeleteCustomerOpen}
        title="删除客户"
        description={`确定要删除「${customer.name}」吗？该客户的 ${customer.letterCount} 条开发信记录也会一并删除，且无法恢复。`}
        confirmText="删除客户"
        variant="destructive"
        loading={customerMutating}
        onConfirm={confirmDeleteCustomer}
      />
    </div>
  );
}
