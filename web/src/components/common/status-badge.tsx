/**
 * 状态彽章：客户 8 段销售状态各用一种颜色区分（见 CUSTOMER_STATUS_BADGE_CLASS）；开发信状态同理
 */
import type * as React from 'react';
import {
  CUSTOMER_STATUS_BADGE_CLASS,
  CUSTOMER_STATUS_LABEL,
  LETTER_STATUS_BADGE_CLASS,
  LETTER_STATUS_LABEL,
  QUOTATION_STATUS_BADGE_CLASS,
  QUOTATION_STATUS_LABEL,
} from '@/constants';
import type { CustomerStatus, LetterStatus, QuotationStatus } from '@/types';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

export function CustomerStatusBadge({
  status,
  className,
  showDot = true,
}: {
  status: CustomerStatus;
  className?: string;
  showDot?: boolean;
}): React.JSX.Element {
  const label = CUSTOMER_STATUS_LABEL[status] ?? status;
  return (
    <Badge variant="outline" className={cn(CUSTOMER_STATUS_BADGE_CLASS[status], 'gap-1.5', className)}>
      {showDot ? <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden /> : null}
      {label}
    </Badge>
  );
}

export function LetterStatusBadge({
  status,
  className,
}: {
  status: LetterStatus;
  className?: string;
}): React.JSX.Element {
  return (
    <Badge variant="outline" className={cn(LETTER_STATUS_BADGE_CLASS[status] ?? LETTER_STATUS_BADGE_CLASS.draft, className)}>
      {LETTER_STATUS_LABEL[status] ?? status}
    </Badge>
  );
}

/** 报价单状态彽章（草稿 / 已发送 / 谈判中 / 已接受 / 已拒绝 / 已过期） */
export function QuotationStatusBadge({
  status,
  className,
  showDot = false,
}: {
  status: QuotationStatus;
  className?: string;
  showDot?: boolean;
}): React.JSX.Element {
  return (
    <Badge
      variant="outline"
      className={cn(QUOTATION_STATUS_BADGE_CLASS[status] ?? QUOTATION_STATUS_BADGE_CLASS.draft, 'gap-1.5', className)}
    >
      {showDot ? <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden /> : null}
      {QUOTATION_STATUS_LABEL[status] ?? status}
    </Badge>
  );
}
