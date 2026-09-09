/**
 * 用户菜单：显示当前登录用户，提供退出登录
 */
import type * as React from 'react';
import { LogOut, UserRound } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuDangerItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useAuthStore } from '@/store/auth.store';
import { initials } from '@/lib/format';
import { cn } from '@/lib/utils';

export function UserMenu({ className }: { className?: string }): React.JSX.Element {
  const user = useAuthStore((state) => state.user);
  const logout = useAuthStore((state) => state.logout);

  const displayName = user?.displayName || user?.username || '未登录';

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          'flex items-center gap-2 rounded-full py-1 pl-1 pr-2 text-sm outline-none transition-colors',
          'hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring',
          className,
        )}
        aria-label="用户菜单"
      >
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
          {initials(displayName)}
        </span>
        <span className="hidden max-w-[8rem] truncate text-xs font-medium sm:inline">{displayName}</span>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuLabel className="font-normal">
          <div className="flex flex-col gap-0.5">
            <span className="text-sm font-medium text-foreground">{displayName}</span>
            <span className="text-xs text-muted-foreground">
              {user?.role === 'admin' ? '管理员' : '普通用户'}
              {user?.username ? ` · ${user.username}` : ''}
            </span>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled>
          <UserRound aria-hidden />
          个人设置（暂未开放）
        </DropdownMenuItem>
        <DropdownMenuDangerItem onSelect={() => logout({ silent: true })}>
          <LogOut aria-hidden />
          退出登录
        </DropdownMenuDangerItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
