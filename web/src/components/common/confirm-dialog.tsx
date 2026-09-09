/**
 * ConfirmDialog —— 通用二次确认弹窗
 * ------------------------------------------------------------------
 * 删除客户、批量删除、清空导入等危险操作统一走这里，
 * 保证文案结构与「确认按钮 loading」行为一致。
 */
import * as React from 'react';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  confirmText?: string;
  cancelText?: string;
  /** destructive 时确认按钮为红色 */
  variant?: 'default' | 'destructive';
  loading?: boolean;
  onConfirm: () => void | Promise<void>;
  /** 额外的说明区块，例如将被删除的客户名单 */
  children?: React.ReactNode;
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmText = '确认',
  cancelText = '取消',
  variant = 'default',
  loading = false,
  onConfirm,
  children,
}: ConfirmDialogProps): React.JSX.Element {
  // 请求进行中禁止关闭，避免用户以为操作被取消
  const handleOpenChange = React.useCallback(
    (next: boolean) => {
      if (loading) return;
      onOpenChange(next);
    },
    [loading, onOpenChange],
  );

  const handleConfirm = React.useCallback(async () => {
    await onConfirm();
  }, [onConfirm]);

  return (
    <AlertDialog open={open} onOpenChange={handleOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          {description ? <AlertDialogDescription>{description}</AlertDialogDescription> : null}
        </AlertDialogHeader>

        {children ? <div className="max-h-56 overflow-y-auto rounded-md bg-muted/50 p-3 text-xs">{children}</div> : null}

        <AlertDialogFooter>
          <AlertDialogCancel disabled={loading}>{cancelText}</AlertDialogCancel>
          <Button
            type="button"
            variant={variant === 'destructive' ? 'destructive' : 'default'}
            loading={loading}
            onClick={() => void handleConfirm()}
            className={cn(variant === 'destructive' && 'focus-visible:ring-destructive')}
          >
            {confirmText}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
