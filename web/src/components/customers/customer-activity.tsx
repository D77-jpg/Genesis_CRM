/**
 * 客户动态区（跟进记录 + 时间线）
 * ------------------------------------------------------------------
 * 自成一体的 Card：内部接管 useFollowUpStore 的拉取 / 写操作 / 重置，
 * 详情页只需放进布局并在跟进可能改动主档时收到 onCustomerChanged 回调。
 *
 * 两个页签：
 *   - 跟进记录：新增 / 编辑 + 历史列表（最新高亮，可删除）
 *   - 客户动态：聚合时间线（建档 / 开发信 / 跟进 / 状态变化 / 跟进计划）
 */
import * as React from 'react';
import { toast } from 'sonner';
import { Activity, History, NotebookPen } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { FollowUpDialog } from '@/components/customers/follow-up-dialog';
import { FollowUpList } from '@/components/customers/follow-up-list';
import { CustomerTimeline } from '@/components/customers/customer-timeline';
import { useFollowUpStore } from '@/store/followup.store';
import type { FollowUp } from '@/types';

export interface CustomerActivityProps {
  customerId: string;
  /** 跟进新增 / 删除后，客户主档的 nextFollowUpAt 可能变化，通知详情页刷新档案 */
  onCustomerChanged?: () => void;
}

export function CustomerActivity({ customerId, onCustomerChanged }: CustomerActivityProps): React.JSX.Element {
  const followUps = useFollowUpStore((state) => state.followUps);
  const timeline = useFollowUpStore((state) => state.timeline);
  const loadingFollowUps = useFollowUpStore((state) => state.loadingFollowUps);
  const loadingTimeline = useFollowUpStore((state) => state.loadingTimeline);
  const mutating = useFollowUpStore((state) => state.mutating);
  const error = useFollowUpStore((state) => state.error);
  const fetchFollowUps = useFollowUpStore((state) => state.fetchFollowUps);
  const fetchTimeline = useFollowUpStore((state) => state.fetchTimeline);
  const deleteFollowUp = useFollowUpStore((state) => state.deleteFollowUp);
  const reset = useFollowUpStore((state) => state.reset);

  const [dialogOpen, setDialogOpen] = React.useState(false);
  // 非空表示编辑该条跟进，null 表示新增
  const [editTarget, setEditTarget] = React.useState<FollowUp | null>(null);
  const [tab, setTab] = React.useState<'followups' | 'timeline'>('followups');

  // 切换客户 / 首次挂载时拉取，卸载时清空，避免串客户数据
  React.useEffect(() => {
    if (!customerId) return;
    void fetchFollowUps(customerId);
    void fetchTimeline(customerId);
    return () => reset();
  }, [customerId, fetchFollowUps, fetchTimeline, reset]);

  const handleDelete = React.useCallback(
    async (item: FollowUp) => {
      try {
        await deleteFollowUp(customerId, item.id);
        toast.success('跟进记录已删除');
      } catch (caught) {
        toast.error('删除失败', { description: caught instanceof Error ? caught.message : String(caught) });
      }
    },
    [customerId, deleteFollowUp],
  );

  const handleCreated = React.useCallback(() => {
    // 新增 / 编辑跟进都可能同步了客户的下一次跟进时间，刷新档案卡片
    onCustomerChanged?.();
  }, [onCustomerChanged]);

  const openCreate = React.useCallback(() => {
    setEditTarget(null);
    setDialogOpen(true);
  }, []);

  const openEdit = React.useCallback((item: FollowUp) => {
    setEditTarget(item);
    setDialogOpen(true);
  }, []);

  // 关闭弹窗时清掉编辑目标，避免下次点「新增」还残留上一条
  const handleDialogOpenChange = React.useCallback((next: boolean) => {
    setDialogOpen(next);
    if (!next) setEditTarget(null);
  }, []);

  return (
    <>
      <Card>
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0">
          <CardTitle className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-muted-foreground" aria-hidden />
            跟进与动态
          </CardTitle>
          <Button type="button" size="sm" onClick={openCreate}>
            <NotebookPen className="h-4 w-4" aria-hidden />
            新增跟进
          </Button>
        </CardHeader>

        <CardContent>
          <Tabs value={tab} onValueChange={(value) => setTab(value as 'followups' | 'timeline')}>
            <TabsList>
              <TabsTrigger value="followups">
                <History className="h-3.5 w-3.5" aria-hidden />
                跟进记录
                {followUps.length > 0 ? (
                  <span className="ml-0.5 rounded-full bg-muted px-1.5 text-xs tabular-nums">{followUps.length}</span>
                ) : null}
              </TabsTrigger>
              <TabsTrigger value="timeline">客户动态</TabsTrigger>
            </TabsList>

            <TabsContent value="followups">
              <FollowUpList
                followUps={followUps}
                loading={loadingFollowUps}
                error={error}
                busy={mutating}
                onRetry={() => void fetchFollowUps(customerId)}
                onDelete={handleDelete}
                onEdit={openEdit}
                onAdd={openCreate}
              />
            </TabsContent>

            <TabsContent value="timeline">
              <CustomerTimeline
                items={timeline?.items ?? []}
                loading={loadingTimeline}
                lastContactAt={timeline?.lastContactAt ?? null}
              />
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      <FollowUpDialog
        open={dialogOpen}
        onOpenChange={handleDialogOpenChange}
        customerId={customerId}
        followUp={editTarget}
        onSaved={handleCreated}
      />
    </>
  );
}
