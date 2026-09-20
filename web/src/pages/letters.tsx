/**
 * 开发信记录页
 * ------------------------------------------------------------------
 * 跨客户查看所有已发送 / 草稿 / 失败的开发信，支持筛选、导出、查看、
 * 重新发送与批量删除。重新发送需要完整客户档案（占位符取值），
 * 因此点击时会先按需拉一次 GET /customers/:id。
 */
import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Download, FilterX } from 'lucide-react';
import { PageHeader } from '@/components/common/page-header';
import { SearchInput } from '@/components/common/search-input';
import { ConfirmDialog } from '@/components/common/confirm-dialog';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { LetterTable } from '@/components/letters/letter-table';
import { LetterViewDialog } from '@/components/letters/letter-view-dialog';
import { SendLetterDialog } from '@/components/letters/send-letter-dialog';
import { useLetterList } from '@/hooks/use-queries';
import { usePageTitle } from '@/hooks/use-ui';
import { useLetterStore, type LetterSortField } from '@/store/letter.store';
import { useMetaStore } from '@/store/meta.store';
import { apiGet, toErrorMessage } from '@/lib/api';
import { downloadFile, stampedFilename } from '@/lib/download';
import { customerDetailPath, LETTER_STATUS_OPTIONS, MAIL_CHANNEL_LABEL } from '@/constants';
import type { Customer, DevelopmentLetter, MailChannel } from '@/types';

/** Select 的「不限」值（Radix 不接受空字符串） */
const ALL = 'all';

const CHANNEL_OPTIONS: { value: string; label: string }[] = [
  { value: ALL, label: '全部通道' },
  ...Object.entries(MAIL_CHANNEL_LABEL).map(([value, label]) => ({ value, label })),
];

export function LettersPage(): React.JSX.Element {
  usePageTitle('开发信记录');
  const navigate = useNavigate();

  /* ---------------------------- store 订阅 ---------------------------- */

  const items = useLetterStore((state) => state.items);
  const total = useLetterStore((state) => state.total);
  const totalPages = useLetterStore((state) => state.totalPages);
  const loading = useLetterStore((state) => state.loading);
  const sending = useLetterStore((state) => state.sending);
  const error = useLetterStore((state) => state.error);
  const selectedIds = useLetterStore((state) => state.selectedIds);

  const search = useLetterStore((state) => state.search);
  const status = useLetterStore((state) => state.status);
  const channel = useLetterStore((state) => state.channel);
  const page = useLetterStore((state) => state.page);
  const limit = useLetterStore((state) => state.limit);
  const sortBy = useLetterStore((state) => state.sortBy);
  const sortOrder = useLetterStore((state) => state.sortOrder);

  const setFilters = useLetterStore((state) => state.setFilters);
  const setPage = useLetterStore((state) => state.setPage);
  const setLimit = useLetterStore((state) => state.setLimit);
  const setSorting = useLetterStore((state) => state.setSorting);
  const resetFilters = useLetterStore((state) => state.resetFilters);
  const buildQuery = useLetterStore((state) => state.buildQuery);
  const fetchList = useLetterStore((state) => state.fetchList);
  const toggleSelect = useLetterStore((state) => state.toggleSelect);
  const toggleSelectAll = useLetterStore((state) => state.toggleSelectAll);
  const clearSelection = useLetterStore((state) => state.clearSelection);
  const deleteLetter = useLetterStore((state) => state.deleteLetter);
  const bulkDelete = useLetterStore((state) => state.bulkDelete);

  const mailChannel = useMetaStore((state) => state.mailChannel);

  useLetterList();

  /* ---------------------------- 本地状态 ---------------------------- */

  const [viewTarget, setViewTarget] = React.useState<DevelopmentLetter | null>(null);
  const [viewOpen, setViewOpen] = React.useState(false);
  const [sendOpen, setSendOpen] = React.useState(false);
  const [sendCustomer, setSendCustomer] = React.useState<Customer | null>(null);
  const [resendTarget, setResendTarget] = React.useState<DevelopmentLetter | null>(null);
  const [deleteTarget, setDeleteTarget] = React.useState<DevelopmentLetter | null>(null);
  const [bulkDeleteOpen, setBulkDeleteOpen] = React.useState(false);
  const [exporting, setExporting] = React.useState(false);
  const [preparing, setPreparing] = React.useState(false);

  const hasFilters = search.trim() !== '' || status !== ALL || channel !== ALL;

  const selectedLetters = React.useMemo(
    () => items.filter((item) => selectedIds.includes(item.id)),
    [items, selectedIds],
  );

  /* ---------------------------- 动作 ---------------------------- */

  /**
   * 重发前先取完整客户档案：SendLetterDialog 的占位符预览需要
   * industry / address 等字段，而列表里的 customer 只是摘要。
   */
  const openResend = React.useCallback(async (letter: DevelopmentLetter) => {
    setViewOpen(false);
    setPreparing(true);
    try {
      const customer = await apiGet<Customer>(`/customers/${letter.customerId}`);
      setSendCustomer(customer);
      setResendTarget(letter);
      setSendOpen(true);
    } catch (caught) {
      toast.error('无法准备重新发送', {
        description: toErrorMessage(caught, '客户信息加载失败，可能已被删除'),
      });
    } finally {
      setPreparing(false);
    }
  }, []);

  const handleSent = React.useCallback(() => {
    void fetchList();
  }, [fetchList]);

  const handleExport = React.useCallback(async () => {
    setExporting(true);
    try {
      const { page: _page, limit: _limit, ...filters } = buildQuery();
      await downloadFile('/letters/export', stampedFilename('开发信记录'), filters);
      toast.success('导出成功', { description: '文件已下载到浏览器默认目录' });
    } catch (caught) {
      toast.error('导出失败', { description: caught instanceof Error ? caught.message : String(caught) });
    } finally {
      setExporting(false);
    }
  }, [buildQuery]);

  const confirmDelete = React.useCallback(async () => {
    if (!deleteTarget) return;
    try {
      await deleteLetter(deleteTarget.id);
      toast.success('开发信记录已删除', { description: '客户的开发信数量会同步减少' });
      setDeleteTarget(null);
      setViewOpen(false);
      await fetchList();
    } catch (caught) {
      toast.error('删除失败', { description: caught instanceof Error ? caught.message : String(caught) });
    }
  }, [deleteTarget, deleteLetter, fetchList]);

  const confirmBulkDelete = React.useCallback(async () => {
    if (selectedIds.length === 0) return;
    try {
      const result = await bulkDelete(selectedIds);
      if (result) toast.success(`已删除 ${result.deleted} 条开发信记录`);
      setBulkDeleteOpen(false);
    } catch (caught) {
      toast.error('批量删除失败', { description: caught instanceof Error ? caught.message : String(caught) });
    }
  }, [selectedIds, bulkDelete]);

  /* ---------------------------- 渲染 ---------------------------- */

  return (
    <div className="space-y-4">
      <PageHeader
        title="开发信记录"
        description={
          total > 0 ? (
            <>
              共 <span className="font-medium text-foreground tabular-nums">{total.toLocaleString('zh-CN')}</span> 条记录
              {hasFilters ? '（已应用筛选条件）' : ''}
            </>
          ) : (
            '所有发送过的开发信都会在这里留档，可随时查看、复制或重新发送'
          )
        }
        actions={
          <>
            {hasFilters ? (
              <Button type="button" variant="ghost" size="sm" onClick={resetFilters}>
                <FilterX className="h-4 w-4" aria-hidden />
                清空筛选
              </Button>
            ) : null}
            <Button
              type="button"
              variant="outline"
              size="sm"
              loading={exporting}
              disabled={exporting || (total === 0 && !loading)}
              onClick={() => void handleExport()}
            >
              {!exporting ? <Download className="h-4 w-4" aria-hidden /> : null}
              导出 Excel
            </Button>
          </>
        }
      />

      {mailChannel === 'mock' ? (
        <Alert variant="warning">
          <AlertDescription>
            当前邮件通道为「模拟发送」：开发信会完整记录并计入统计，但不会真实投递到收件人邮箱。
          </AlertDescription>
        </Alert>
      ) : null}

      {/* ---------------------------- 筛选栏 ---------------------------- */}

      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <SearchInput
          value={search}
          onChange={(value) => setFilters({ search: value })}
          placeholder="搜索主题 / 收件人 / 邮箱…"
          className="w-full sm:w-64 lg:w-72"
          aria-label="搜索开发信"
        />

        <Select value={status} onValueChange={(value) => setFilters({ status: value as typeof status })}>
          <SelectTrigger className="h-8 w-auto min-w-[7.5rem] max-w-[12rem] text-xs" aria-label="开发信状态">
            <SelectValue placeholder="全部状态" />
          </SelectTrigger>
          <SelectContent>
            {LETTER_STATUS_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value} className="text-xs">
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={channel} onValueChange={(value) => setFilters({ channel: value as MailChannel | 'all' })}>
          <SelectTrigger className="h-8 w-auto min-w-[8rem] max-w-[13rem] text-xs" aria-label="发送通道">
            <SelectValue placeholder="全部通道" />
          </SelectTrigger>
          <SelectContent>
            {CHANNEL_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value} className="text-xs">
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {preparing ? <span className="text-xs text-muted-foreground">正在准备重新发送…</span> : null}
      </div>

      {/* ---------------------------- 表格 ---------------------------- */}

      <Card className="relative overflow-hidden">
        <LetterTable
          letters={items}
          loading={loading}
          error={error}
          selectedIds={selectedIds}
          sortBy={sortBy}
          sortOrder={sortOrder}
          hasFilters={hasFilters}
          busy={sending}
          onSort={(field: LetterSortField) => setSorting(field)}
          onToggleSelect={toggleSelect}
          onToggleSelectAll={toggleSelectAll}
          onView={(letter) => {
            setViewTarget(letter);
            setViewOpen(true);
          }}
          onResend={(letter) => void openResend(letter)}
          onDelete={setDeleteTarget}
          onRetry={() => void fetchList()}
          onResetFilters={resetFilters}
          page={page}
          limit={limit}
          total={total}
          totalPages={totalPages}
          onPageChange={setPage}
          onLimitChange={setLimit}
        />
      </Card>

      {/* ---------------------------- 批量操作条 ---------------------------- */}

      {selectedIds.length > 0 ? (
        <div
          className="sticky bottom-3 z-20 flex flex-wrap items-center gap-2 rounded-lg border border-primary/30 bg-card/95 px-3 py-2 shadow-lg backdrop-blur animate-in slide-in-from-bottom-2 duration-200"
          role="toolbar"
          aria-label="批量操作"
        >
          <span className="flex items-center gap-1.5 text-sm font-medium">
            已选
            <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-primary px-2 text-xs font-semibold tabular-nums text-primary-foreground">
              {selectedIds.length}
            </span>
            条记录
          </span>
          <Button
            type="button"
            variant="destructive"
            size="sm"
            disabled={sending}
            loading={sending}
            onClick={() => setBulkDeleteOpen(true)}
          >
            删除所选
          </Button>
          <Button type="button" variant="ghost" size="sm" className="ml-auto" onClick={clearSelection}>
            取消选择
          </Button>
        </div>
      ) : null}

      {/* ---------------------------- 弹窗 ---------------------------- */}

      <LetterViewDialog
        open={viewOpen}
        onOpenChange={(open) => {
          setViewOpen(open);
          if (!open) setViewTarget(null);
        }}
        letter={viewTarget}
        onResend={(letter) => void openResend(letter)}
        onDelete={setDeleteTarget}
        onOpenCustomer={(customerId) => {
          setViewOpen(false);
          navigate(customerDetailPath(customerId));
        }}
      />

      <SendLetterDialog
        open={sendOpen}
        onOpenChange={(open) => {
          setSendOpen(open);
          if (!open) {
            setResendTarget(null);
            setSendCustomer(null);
          }
        }}
        customer={sendCustomer}
        letter={resendTarget}
        onSent={handleSent}
      />

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="删除开发信记录"
        description={
          deleteTarget
            ? `确定要删除「${deleteTarget.subject || '（无主题）'}」这条记录吗？删除后无法恢复。`
            : undefined
        }
        confirmText="删除"
        variant="destructive"
        loading={sending}
        onConfirm={confirmDelete}
      />

      <ConfirmDialog
        open={bulkDeleteOpen}
        onOpenChange={setBulkDeleteOpen}
        title={`删除 ${selectedIds.length} 条开发信记录`}
        description="这些记录会被永久删除，客户的开发信数量会同步减少。"
        confirmText="全部删除"
        variant="destructive"
        loading={sending}
        onConfirm={confirmBulkDelete}
      >
        {selectedLetters.length > 0 ? (
          <ul className="space-y-1">
            {selectedLetters.slice(0, 20).map((letter) => (
              <li key={letter.id} className="flex items-center justify-between gap-2">
                <span className="truncate font-medium">{letter.subject || '（无主题）'}</span>
                <span className="shrink-0 truncate text-muted-foreground">{letter.recipientEmail}</span>
              </li>
            ))}
            {selectedLetters.length > 20 ? (
              <li className="pt-1 text-muted-foreground">…等共 {selectedLetters.length} 条</li>
            ) : null}
          </ul>
        ) : null}
      </ConfirmDialog>
    </div>
  );
}
