/**
 * 用户管理页（仅管理员）
 * ------------------------------------------------------------------
 * 列出全部账号，支持新建 / 编辑资料 / 重置密码 / 停用启用 / 删除。
 * 严格分配制下：管理员在「客户管理」里把未分配客户指派给业务员，
 * 业务员登录后只看自己名下客户——本页是这些账号的来源。
 * 自我保护：不能停用 / 删除当前登录的自己（前端禁用 + 后端拦截双重保险）。
 */
import * as React from 'react';
import { toast } from 'sonner';
import {
  Ban,
  CheckCircle2,
  KeyRound,
  MoreHorizontal,
  Pencil,
  ShieldCheck,
  Trash2,
  UserCog,
  UserPlus,
} from 'lucide-react';
import { PageHeader } from '@/components/common/page-header';
import { EmptyState, ErrorState } from '@/components/common/empty-state';
import { ConfirmDialog } from '@/components/common/confirm-dialog';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { TableSkeleton } from '@/components/ui/separator';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuDangerItem,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { UserFormDialog } from '@/components/users/user-form-dialog';
import { ResetPasswordDialog } from '@/components/users/reset-password-dialog';
import { usePageTitle } from '@/hooks/use-ui';
import { useUserStore } from '@/store/user.store';
import { useAuthStore } from '@/store/auth.store';
import {
  USER_ROLE_BADGE_CLASS,
  USER_ROLE_LABEL,
  USER_STATUS_BADGE_CLASS,
  USER_STATUS_LABEL,
} from '@/constants';
import { formatDateTime, formatRelative, initials } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { UserDto } from '@/types';

interface RowActionHandlers {
  onEdit: (user: UserDto) => void;
  onResetPassword: (user: UserDto) => void;
  onToggleStatus: (user: UserDto) => void;
  onDelete: (user: UserDto) => void;
}

/** 行操作菜单：编辑资料 / 重置密码 / 停用启用 / 删除（对当前登录自己禁用停用与删除） */
function RowActions({
  user,
  isSelf,
  onEdit,
  onResetPassword,
  onToggleStatus,
  onDelete,
}: { user: UserDto; isSelf: boolean } & RowActionHandlers): React.JSX.Element {
  const isDisabledAccount = user.status === 'disabled';
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label={`更多操作：${user.displayName || user.username}`}
        >
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuItem onClick={() => onEdit(user)}>
          <Pencil className="h-4 w-4" aria-hidden />
          编辑资料
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => onResetPassword(user)}>
          <KeyRound className="h-4 w-4" aria-hidden />
          重置密码
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled={isSelf} onClick={() => onToggleStatus(user)}>
          {isDisabledAccount ? (
            <CheckCircle2 className="h-4 w-4" aria-hidden />
          ) : (
            <Ban className="h-4 w-4" aria-hidden />
          )}
          {isDisabledAccount ? '启用账号' : '停用账号'}
        </DropdownMenuItem>
        <DropdownMenuDangerItem disabled={isSelf} onClick={() => onDelete(user)}>
          <Trash2 className="h-4 w-4" aria-hidden />
          删除账号
        </DropdownMenuDangerItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** 单个账号行：头像 + 显示名 / 用户名 + 角色徽章 + 状态徽章 + 最近登录 / 创建时间 + 操作 */
function UserRow({
  user,
  isSelf,
  ...handlers
}: { user: UserDto; isSelf: boolean } & RowActionHandlers): React.JSX.Element {
  return (
    <li className="flex flex-wrap items-center gap-3 px-4 py-3">
      <span
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary"
        aria-hidden
      >
        {initials(user.displayName || user.username)}
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium">{user.displayName || user.username}</span>
          {isSelf ? <Badge variant="muted">当前登录</Badge> : null}
        </div>
        <span className="block truncate text-xs text-muted-foreground">@{user.username}</span>
      </div>

      <Badge variant="outline" className={cn('gap-1 font-normal', USER_ROLE_BADGE_CLASS[user.role])}>
        {user.role === 'admin' ? (
          <ShieldCheck className="h-3 w-3" aria-hidden />
        ) : (
          <UserCog className="h-3 w-3" aria-hidden />
        )}
        {USER_ROLE_LABEL[user.role]}
      </Badge>

      <Badge variant="outline" className={cn('gap-1 font-normal', USER_STATUS_BADGE_CLASS[user.status])}>
        {user.status === 'disabled' ? (
          <Ban className="h-3 w-3" aria-hidden />
        ) : (
          <CheckCircle2 className="h-3 w-3" aria-hidden />
        )}
        {USER_STATUS_LABEL[user.status]}
      </Badge>

      <div className="w-full shrink-0 text-xs text-muted-foreground sm:w-auto sm:text-right">
        <div>{user.lastLoginAt ? `最近登录 ${formatRelative(user.lastLoginAt)}` : '尚未登录'}</div>
        <div className="text-2xs">创建于 {formatDateTime(user.createdAt)}</div>
      </div>

      <RowActions user={user} isSelf={isSelf} {...handlers} />
    </li>
  );
}

export function UsersPage(): React.JSX.Element {
  usePageTitle('用户管理');

  const items = useUserStore((state) => state.items);
  const loading = useUserStore((state) => state.loading);
  const error = useUserStore((state) => state.error);
  const fetchList = useUserStore((state) => state.fetchList);
  const setStatus = useUserStore((state) => state.setStatus);
  const deleteUser = useUserStore((state) => state.deleteUser);
  const currentUserId = useAuthStore((state) => state.user?.id);

  // 表单弹窗（新建 / 编辑）
  const [formOpen, setFormOpen] = React.useState(false);
  const [editingUser, setEditingUser] = React.useState<UserDto | null>(null);
  // 重置密码弹窗
  const [resetOpen, setResetOpen] = React.useState(false);
  const [resetTarget, setResetTarget] = React.useState<UserDto | null>(null);
  // 危险操作二次确认（停用 / 删除）
  const [confirm, setConfirm] = React.useState<{ kind: 'delete' | 'disable'; user: UserDto } | null>(null);
  const [confirmLoading, setConfirmLoading] = React.useState(false);

  // 进入页面拉取一次全量账号
  React.useEffect(() => {
    void fetchList();
  }, [fetchList]);

  const adminCount = React.useMemo(() => items.filter((user) => user.role === 'admin').length, [items]);

  const openCreate = React.useCallback(() => {
    setEditingUser(null);
    setFormOpen(true);
  }, []);

  const openEdit = React.useCallback((user: UserDto) => {
    setEditingUser(user);
    setFormOpen(true);
  }, []);

  const openReset = React.useCallback((user: UserDto) => {
    setResetTarget(user);
    setResetOpen(true);
  }, []);

  // 启用直接执行；停用需要二次确认
  const handleToggleStatus = React.useCallback(
    async (user: UserDto) => {
      if (user.status === 'disabled') {
        try {
          await setStatus(user.id, 'active');
          toast.success('账号已启用', { description: `${user.displayName || user.username} 可重新登录` });
        } catch (err) {
          toast.error('启用失败', { description: err instanceof Error ? err.message : '请稍后重试' });
        }
      } else {
        setConfirm({ kind: 'disable', user });
      }
    },
    [setStatus],
  );

  const handleDelete = React.useCallback((user: UserDto) => {
    setConfirm({ kind: 'delete', user });
  }, []);

  const runConfirm = React.useCallback(async () => {
    if (!confirm) return;
    setConfirmLoading(true);
    const name = confirm.user.displayName || confirm.user.username;
    try {
      if (confirm.kind === 'delete') {
        const result = await deleteUser(confirm.user.id);
        const moved = result?.reassignedCustomers ?? 0;
        toast.success('账号已删除', {
          description: moved > 0 ? `${name} 已删除，${moved} 个客户转为未分配` : `${name} 已删除`,
        });
      } else {
        await setStatus(confirm.user.id, 'disabled');
        toast.success('账号已停用', { description: `${name} 立即无法登录，已登录会话同步失效` });
      }
      setConfirm(null);
    } catch (err) {
      toast.error(confirm.kind === 'delete' ? '删除失败' : '停用失败', {
        description: err instanceof Error ? err.message : '请稍后重试',
      });
    } finally {
      setConfirmLoading(false);
    }
  }, [confirm, deleteUser, setStatus]);

  let body: React.ReactNode;
  if (error) {
    body = <ErrorState title="用户列表加载失败" description={error} onRetry={() => void fetchList()} retrying={loading} />;
  } else if (loading && items.length === 0) {
    body = (
      <div className="p-3">
        <TableSkeleton rows={5} columns={4} />
      </div>
    );
  } else if (items.length === 0) {
    body = (
      <EmptyState
        title="还没有其他账号"
        description="创建业务员账号后，在「客户管理」里把客户分配给他们"
        action={
          <Button type="button" size="sm" onClick={openCreate}>
            <UserPlus className="h-3.5 w-3.5" aria-hidden />
            新建用户
          </Button>
        }
      />
    );
  } else {
    body = (
      <ul className="divide-y">
        {items.map((user) => (
          <UserRow
            key={user.id}
            user={user}
            isSelf={currentUserId === user.id}
            onEdit={openEdit}
            onResetPassword={openReset}
            onToggleStatus={(target) => void handleToggleStatus(target)}
            onDelete={handleDelete}
          />
        ))}
      </ul>
    );
  }

  const confirmIsDelete = confirm?.kind === 'delete';
  const confirmName = confirm ? confirm.user.displayName || confirm.user.username : '';

  return (
    <div className="space-y-4">
      <PageHeader
        title="用户管理"
        description={
          items.length > 0 ? (
            <>
              共 <span className="font-medium text-foreground tabular-nums">{items.length}</span> 个账号
              {adminCount > 0 ? `，其中管理员 ${adminCount} 个` : ''}
            </>
          ) : (
            '创建业务员账号后，在「客户管理」里把客户分配给他们；业务员只能看到自己名下的客户'
          )
        }
        actions={
          <Button type="button" size="sm" onClick={openCreate}>
            <UserPlus className="h-4 w-4" aria-hidden />
            新建用户
          </Button>
        }
      />

      <Card className="overflow-hidden">{body}</Card>

      <UserFormDialog key={editingUser?.id ?? 'new'} open={formOpen} onOpenChange={setFormOpen} user={editingUser} />
      <ResetPasswordDialog open={resetOpen} onOpenChange={setResetOpen} user={resetTarget} />
      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(next) => {
          if (!next && !confirmLoading) setConfirm(null);
        }}
        variant={confirmIsDelete ? 'destructive' : 'default'}
        title={confirmIsDelete ? '删除账号' : '停用账号'}
        description={
          confirmIsDelete
            ? `确认删除「${confirmName}」？此操作不可撤销。`
            : `确认停用「${confirmName}」？停用后该账号立即无法登录。`
        }
        confirmText={confirmIsDelete ? '删除' : '停用'}
        loading={confirmLoading}
        onConfirm={runConfirm}
      >
        {confirmIsDelete ? (
          <p>该账号名下的客户将全部转为「未分配」，回到管理员池后可重新分配。</p>
        ) : (
          <p>已登录的会话会同步失效；如需恢复，可随时在该账号上选择「启用」。</p>
        )}
      </ConfirmDialog>
    </div>
  );
}
