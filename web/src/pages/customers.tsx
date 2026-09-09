/**
 * 客户管理页
 * ------------------------------------------------------------------
 * 组合：页头操作区 + 筛选栏 + 表格 + 分页 + 批量操作条 + 各类弹窗。
 * 数据与条件全部托管在 useCustomerStore，页面只负责「组装」与「交互反馈」。
 */
import * as React from 'react';
import { toast } from 'sonner';
import { Download, FileSpreadsheet, UserPlus } from 'lucide-react';
import { PageHeader } from '@/components/common/page-header';
import { DataPagination } from '@/components/common/data-pagination';
import { ConfirmDialog } from '@/components/common/confirm-dialog';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { CustomerTable } from '@/components/customers/customer-table';
import { CustomerFilters, type CustomerFilterValues } from '@/components/customers/customer-filters';
import { BulkActionsBar } from '@/components/customers/bulk-actions-bar';
import {
  BulkActionDialog,
  type BulkActionKind,
  type BulkActionPayload,
} from '@/components/customers/bulk-action-dialog';
import { CustomerFormDialog } from '@/components/customers/customer-form-dialog';
import { ImportDialog } from '@/components/customers/import-dialog';
import { SendLetterDialog } from '@/components/letters/send-letter-dialog';
import { useCustomerList, useIndustries, useOwners, useTags } from '@/hooks/use-queries';
import { usePageTitle } from '@/hooks/use-ui';
import { selectHasActiveFilters, useCustomerStore } from '@/store/customer.store';
import { selectIsAdmin, useAuthStore } from '@/store/auth.store';
import { downloadFile, stampedFilename } from '@/lib/download';
import { CUSTOMER_STATUS_LABEL } from '@/constants';
import type { Customer, CustomerStatus, SendLetterResult } from '@/types';

export function CustomersPage(): React.JSX.Element {
  usePageTitle('客户管理');

  // 严格分配制：负责人相关 UI（筛选 / 列 / 批量分配）仅管理员可见
  const isAdmin = useAuthStore(selectIsAdmin);

  /* ---------------------------- store 订阅 ---------------------------- */

  const items = useCustomerStore((state) => state.items);
  const total = useCustomerStore((state) => state.total);
  const totalPages = useCustomerStore((state) => state.totalPages);
  const loading = useCustomerStore((state) => state.loading);
  const mutating = useCustomerStore((state) => state.mutating);
  const error = useCustomerStore((state) => state.error);
  const selectedIds = useCustomerStore((state) => state.selectedIds);
  const industries = useCustomerStore((state) => state.industries);
  const tags = useCustomerStore((state) => state.tags);
  const owners = useCustomerStore((state) => state.owners);

  const search = useCustomerStore((state) => state.search);
  const status = useCustomerStore((state) => state.status);
  const industry = useCustomerStore((state) => state.industry);
  const grade = useCustomerStore((state) => state.grade);
  const leadSource = useCustomerStore((state) => state.leadSource);
  const priority = useCustomerStore((state) => state.priority);
  const hasEmail = useCustomerStore((state) => state.hasEmail);
  const tag = useCustomerStore((state) => state.tag);
  const ownerId = useCustomerStore((state) => state.ownerId);
  const followUp = useCustomerStore((state) => state.followUp);
  const page = useCustomerStore((state) => state.page);
  const limit = useCustomerStore((state) => state.limit);
  const sortBy = useCustomerStore((state) => state.sortBy);
  const sortOrder = useCustomerStore((state) => state.sortOrder);

  const setFilters = useCustomerStore((state) => state.setFilters);
  const setPage = useCustomerStore((state) => state.setPage);
  const setLimit = useCustomerStore((state) => state.setLimit);
  const setSorting = useCustomerStore((state) => state.setSorting);
  const resetFilters = useCustomerStore((state) => state.resetFilters);
  const buildQuery = useCustomerStore((state) => state.buildQuery);
  const fetchList = useCustomerStore((state) => state.fetchList);
  const toggleSelect = useCustomerStore((state) => state.toggleSelect);
  const toggleSelectAll = useCustomerStore((state) => state.toggleSelectAll);
  const clearSelection = useCustomerStore((state) => state.clearSelection);
  const deleteCustomer = useCustomerStore((state) => state.deleteCustomer);
  const bulkUpdateStatus = useCustomerStore((state) => state.bulkUpdateStatus);
  const bulkDelete = useCustomerStore((state) => state.bulkDelete);
  const bulkAddTags = useCustomerStore((state) => state.bulkAddTags);
  const bulkRemoveTags = useCustomerStore((state) => state.bulkRemoveTags);
  const bulkAssignOwner = useCustomerStore((state) => state.bulkAssignOwner);
  const bulkSetFollowUp = useCustomerStore((state) => state.bulkSetFollowUp);

  const hasActiveFilters = useCustomerStore(selectHasActiveFilters);

  // 条件变化 → 自动拉数据
  useCustomerList();
  useIndustries();
  useTags();
  useOwners();

  /* ---------------------------- 本地 UI 状态 ---------------------------- */

  const [formOpen, setFormOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<Customer | null>(null);
  const [importOpen, setImportOpen] = React.useState(false);
  const [sendTarget, setSendTarget] = React.useState<Customer | null>(null);
  const [sendOpen, setSendOpen] = React.useState(false);
  const [deleting, setDeleting] = React.useState<Customer | null>(null);
  const [bulkDeleteOpen, setBulkDeleteOpen] = React.useState(false);
  /** 当前打开的批量动作弹窗（标签 / 负责人 / 跟进时间）；null 表示未打开 */
  const [bulkKind, setBulkKind] = React.useState<BulkActionKind | null>(null);
  const [exporting, setExporting] = React.useState(false);

  /* ---------------------------- 派生数据 ---------------------------- */

  const filterValues = React.useMemo<CustomerFilterValues>(
    () => ({ search, status, industry, grade, leadSource, priority, hasEmail, tag, ownerId, followUp }),
    [search, status, industry, grade, leadSource, priority, hasEmail, tag, ownerId, followUp],
  );

  // 等级候选来自当前页数据（后端不提供聚合接口，够用且不额外请求）
  const grades = React.useMemo(() => {
    const set = new Set<string>();
    items.forEach((item) => {
      if (item.grade) set.add(item.grade);
    });
    return Array.from(set).sort();
  }, [items]);

  const selectedCustomers = React.useMemo(
    () => items.filter((item) => selectedIds.includes(item.id)),
    [items, selectedIds],
  );

  /* ---------------------------- 动作 ---------------------------- */

  const openCreate = React.useCallback(() => {
    setEditing(null);
    setFormOpen(true);
  }, []);

  const openEdit = React.useCallback((customer: Customer) => {
    setEditing(customer);
    setFormOpen(true);
  }, []);

  const openSend = React.useCallback((customer: Customer) => {
    setSendTarget(customer);
    setSendOpen(true);
  }, []);

  const handleSent = React.useCallback(
    (result: SendLetterResult) => {
      // 发信后客户状态/开发信数可能变化，直接刷新列表即可
      void fetchList();
      if (result.customer) setSendTarget(result.customer);
    },
    [fetchList],
  );

  const handleExport = React.useCallback(async () => {
    setExporting(true);
    try {
      // 导出不受分页限制，只带筛选条件
      const { page: _page, limit: _limit, ...filters } = buildQuery();
      await downloadFile('/customers/export', stampedFilename('客户列表'), filters);
      toast.success('导出成功', { description: '文件已下载到浏览器默认目录' });
    } catch (caught) {
      toast.error('导出失败', { description: caught instanceof Error ? caught.message : String(caught) });
    } finally {
      setExporting(false);
    }
  }, [buildQuery]);

  const confirmDelete = React.useCallback(async () => {
    if (!deleting) return;
    try {
      const result = await deleteCustomer(deleting.id);
      if (result) {
        toast.success('客户已删除', {
          description: `同时清理了该客户的开发信记录`,
        });
      }
      setDeleting(null);
    } catch (caught) {
      toast.error('删除失败', { description: caught instanceof Error ? caught.message : String(caught) });
    }
  }, [deleting, deleteCustomer]);

  const confirmBulkDelete = React.useCallback(async () => {
    if (selectedIds.length === 0) return;
    try {
      const result = await bulkDelete(selectedIds);
      if (result) {
        toast.success(`已删除 ${result.deleted} 位客户`, {
          description: result.deletedLetters > 0 ? `同时清理了 ${result.deletedLetters} 条开发信记录` : undefined,
        });
      }
      setBulkDeleteOpen(false);
    } catch (caught) {
      toast.error('批量删除失败', { description: caught instanceof Error ? caught.message : String(caught) });
    }
  }, [selectedIds, bulkDelete]);

  const handleBulkStatus = React.useCallback(
    async (next: CustomerStatus) => {
      if (selectedIds.length === 0) return;
      try {
        const result = await bulkUpdateStatus(selectedIds, next);
        if (result) {
          toast.success(`已将 ${result.modified} 位客户标记为「${CUSTOMER_STATUS_LABEL[next]}」`);
        }
      } catch (caught) {
        toast.error('批量修改状态失败', { description: caught instanceof Error ? caught.message : String(caught) });
      }
    },
    [selectedIds, bulkUpdateStatus],
  );

  // 标签 / 负责人 / 跟进时间：统一由 BulkActionDialog 确认后回调到这里
  const handleBulkAction = React.useCallback(
    async (kind: BulkActionKind, payload: BulkActionPayload) => {
      if (selectedIds.length === 0) return;
      try {
        let message = '';
        if (kind === 'addTags' && payload.tags) {
          const result = await bulkAddTags(selectedIds, payload.tags);
          message = result ? `已为 ${result.matched} 位客户添加标签：${payload.tags.join('、')}` : '';
        } else if (kind === 'removeTags' && payload.tags) {
          const result = await bulkRemoveTags(selectedIds, payload.tags);
          message = result ? `已从 ${result.matched} 位客户移除标签：${payload.tags.join('、')}` : '';
        } else if (kind === 'assignOwner') {
          const result = await bulkAssignOwner(selectedIds, payload.ownerId ?? null);
          const ownerName = payload.ownerId
            ? owners.find((owner) => owner.id === payload.ownerId)?.name ?? '所选负责人'
            : '未分配';
          message = result ? `已将 ${result.matched} 位客户的负责人设为「${ownerName}」` : '';
        } else if (kind === 'setFollowUp') {
          const result = await bulkSetFollowUp(selectedIds, payload.nextFollowUpAt ?? null);
          message = result ? `已为 ${result.matched} 位客户设置下一次跟进：${payload.nextFollowUpAt}` : '';
        }
        if (message) toast.success(message);
        setBulkKind(null);
      } catch (caught) {
        toast.error('批量操作失败', { description: caught instanceof Error ? caught.message : String(caught) });
      }
    },
    [selectedIds, owners, bulkAddTags, bulkRemoveTags, bulkAssignOwner, bulkSetFollowUp],
  );

  /* ---------------------------- 渲染 ---------------------------- */

  return (
    <div className="space-y-4">
      <PageHeader
        title="客户管理"
        description={
          total > 0 ? (
            <>
              共 <span className="font-medium text-foreground tabular-nums">{total.toLocaleString('zh-CN')}</span> 位客户
              {hasActiveFilters ? '（已应用筛选条件）' : ''}
            </>
          ) : (
            '导入 Excel 或手工新建客户，随后即可批量发送开发信'
          )
        }
        actions={
          <>
            <Button type="button" variant="outline" size="sm" onClick={() => setImportOpen(true)}>
              <FileSpreadsheet className="h-4 w-4" aria-hidden />
              导入 Excel
            </Button>
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
            <Button type="button" size="sm" onClick={openCreate}>
              <UserPlus className="h-4 w-4" aria-hidden />
              新建客户
            </Button>
          </>
        }
      />

      <CustomerFilters
        values={filterValues}
        industries={industries}
        grades={grades}
        tags={tags}
        owners={owners}
        showOwner={isAdmin}
        hasActiveFilters={hasActiveFilters}
        disabled={loading && items.length === 0}
        onChange={(patch) => setFilters(patch)}
        onReset={resetFilters}
      />

      <Card className="relative overflow-hidden">
        <CustomerTable
          customers={items}
          loading={loading}
          error={error}
          selectedIds={selectedIds}
          sortBy={sortBy}
          sortOrder={sortOrder}
          hasFilters={hasActiveFilters}
          showOwner={isAdmin}
          onSort={setSorting}
          onToggleSelect={toggleSelect}
          onToggleSelectAll={toggleSelectAll}
          onRetry={() => void fetchList()}
          onEdit={openEdit}
          onSend={openSend}
          onDelete={setDeleting}
          onCreate={openCreate}
          onImport={() => setImportOpen(true)}
          onResetFilters={resetFilters}
        />

        <DataPagination
          page={page}
          limit={limit}
          total={total}
          totalPages={totalPages}
          onPageChange={setPage}
          onLimitChange={setLimit}
          disabled={loading}
          extra={
            selectedIds.length > 0 ? (
              <span className="text-primary">
                已选 <span className="font-medium tabular-nums">{selectedIds.length}</span> 项
              </span>
            ) : null
          }
        />
      </Card>

      <BulkActionsBar
        selectedCount={selectedIds.length}
        busy={mutating}
        disabled={loading}
        canAssignOwner={isAdmin}
        onStatusChange={(next) => void handleBulkStatus(next)}
        onAssignOwner={() => setBulkKind('assignOwner')}
        onManageTags={() => setBulkKind('addTags')}
        onSetFollowUp={() => setBulkKind('setFollowUp')}
        onDelete={() => setBulkDeleteOpen(true)}
        onClear={clearSelection}
      />

      <BulkActionDialog
        open={bulkKind !== null}
        kind={bulkKind}
        selectedCount={selectedIds.length}
        tags={tags}
        owners={owners}
        busy={mutating}
        onOpenChange={(open) => {
          if (!open) setBulkKind(null);
        }}
        onKindChange={(kind) => setBulkKind(kind)}
        onConfirm={handleBulkAction}
      />

      {/* ---------------------------- 弹窗 ---------------------------- */}

      <CustomerFormDialog
        open={formOpen}
        onOpenChange={(open) => {
          setFormOpen(open);
          if (!open) setEditing(null);
        }}
        customer={editing}
        industries={industries}
        owners={owners}
      />

      <ImportDialog open={importOpen} onOpenChange={setImportOpen} />

      <SendLetterDialog
        open={sendOpen}
        onOpenChange={(open) => {
          setSendOpen(open);
          if (!open) setSendTarget(null);
        }}
        customer={sendTarget}
        onSent={handleSent}
      />

      <ConfirmDialog
        open={Boolean(deleting)}
        onOpenChange={(open) => !open && setDeleting(null)}
        title="删除客户"
        description={
          deleting
            ? `确定要删除「${deleting.name}」吗？该客户的 ${deleting.letterCount} 条开发信记录也会一并删除，且无法恢复。`
            : undefined
        }
        confirmText="删除"
        variant="destructive"
        loading={mutating}
        onConfirm={confirmDelete}
      />

      <ConfirmDialog
        open={bulkDeleteOpen}
        onOpenChange={setBulkDeleteOpen}
        title={`删除 ${selectedIds.length} 位客户`}
        description="这些客户及其全部开发信记录都会被删除，且无法恢复。"
        confirmText="全部删除"
        variant="destructive"
        loading={mutating}
        onConfirm={confirmBulkDelete}
      >
        {selectedCustomers.length > 0 ? (
          <ul className="space-y-1">
            {selectedCustomers.slice(0, 20).map((customer) => (
              <li key={customer.id} className="flex items-center justify-between gap-2">
                <span className="truncate font-medium">{customer.name}</span>
                <span className="shrink-0 truncate text-muted-foreground">{customer.company || customer.email || '—'}</span>
              </li>
            ))}
            {selectedCustomers.length > 20 ? (
              <li className="pt-1 text-muted-foreground">…等共 {selectedCustomers.length} 位</li>
            ) : null}
          </ul>
        ) : null}
      </ConfirmDialog>
    </div>
  );
}
