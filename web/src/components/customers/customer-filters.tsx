/**
 * 客户列表筛选栏
 * ------------------------------------------------------------------
 * 搜索（姓名 / 公司 / 邮箱）+ 状态 + 邮箱有无 + 行业 + 等级 + 来源。
 * 所有条件都写回 store，由 useCustomerList() 监听变化后拉数据。
 * Radix Select 不接受空字符串 value，「不限」统一用 'all' 或独立的 NONE 值。
 */
import * as React from 'react';
import { FilterX } from 'lucide-react';
import { SearchInput } from '@/components/common/search-input';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  CUSTOMER_LEAD_SOURCE_FILTER_OPTIONS,
  CUSTOMER_PRIORITY_FILTER_OPTIONS,
  CUSTOMER_STATUS_OPTIONS,
  FOLLOW_UP_FILTER_OPTIONS,
} from '@/constants';
import { useDebouncedCallback } from '@/hooks/use-debounce';
import type { HasEmailFilter } from '@/store/customer.store';
import type { CustomerPriority, CustomerStatus, FollowUpFilter, OwnerOption } from '@/types';

/** Select 里表示「不限」的值（Radix 不允许 value=""） */
const ALL = 'all';
/** 负责人筛选：未分配 */
const UNASSIGNED = 'unassigned';

export interface CustomerFilterValues {
  search: string;
  status: CustomerStatus | 'all';
  industry: string;
  grade: string;
  /** 业务来源筛选（'' 表示不限） */
  leadSource: string;
  /** 跟进优先级筛选（'all' 表示不限） */
  priority: CustomerPriority | 'all';
  hasEmail: HasEmailFilter;
  /** 标签精确筛选（'' 表示不限） */
  tag: string;
  /** 负责人筛选：'all' / 'unassigned' / 具体用户 id */
  ownerId: string;
  /** 跟进时间筛选 */
  followUp: FollowUpFilter;
}

export interface CustomerFiltersProps {
  values: CustomerFilterValues;
  /** 行业候选（来自已有数据） */
  industries: string[];
  /** 等级候选（来自当前页数据） */
  grades: string[];
  /** 标签词汇表（所有客户标签去重） */
  tags: string[];
  /** 负责人候选 */
  owners: OwnerOption[];
  /** 是否展示「负责人」筛选（仅管理员；业务员只看自己名下客户，无需此筛选） */
  showOwner?: boolean;
  disabled?: boolean;
  hasActiveFilters: boolean;
  onChange: (patch: Partial<CustomerFilterValues>) => void;
  onReset: () => void;
}

/** 紧凑下拉，统一尺寸与无障碍标签 */
function FilterSelect({
  label,
  value,
  options,
  onValueChange,
  disabled,
  className,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onValueChange: (value: string) => void;
  disabled?: boolean;
  className?: string;
}): React.JSX.Element {
  return (
    <Select value={value} onValueChange={onValueChange} disabled={disabled}>
      <SelectTrigger className={className ?? 'h-8 w-auto min-w-[7.5rem] max-w-[12rem] text-xs'} aria-label={label}>
        <SelectValue placeholder={label} />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value} className="text-xs">
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

const STATUS_OPTIONS = [{ value: ALL, label: '全部状态' }, ...CUSTOMER_STATUS_OPTIONS];

const EMAIL_OPTIONS = [
  { value: ALL, label: '邮箱不限' },
  { value: 'yes', label: '有邮箱' },
  { value: 'no', label: '无邮箱' },
];

/**
 * 等级筛选：自由文本，本地即时输入 + 防抖回写，避免每敲一个字就请求一次。
 * 候选值由父级的 <datalist id="customer-grade-options"> 提供。
 */
function GradeFilter({
  value,
  disabled,
  onChange,
}: {
  value: string;
  disabled?: boolean;
  onChange: (grade: string) => void;
}): React.JSX.Element {
  const [text, setText] = React.useState(value);
  const emit = useDebouncedCallback(onChange, 400);

  // 外部「清空筛选」时同步回输入框
  React.useEffect(() => {
    setText(value);
  }, [value]);

  return (
    <Input
      value={text}
      onChange={(event) => {
        setText(event.target.value);
        emit(event.target.value.trim());
      }}
      onBlur={() => emit.flush()}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          emit.flush();
        }
        if (event.key === 'Escape' && text) {
          event.preventDefault();
          setText('');
          emit.cancel();
          onChange('');
        }
      }}
      list="customer-grade-options"
      placeholder="等级"
      disabled={disabled}
      aria-label="客户等级"
      className="h-8 w-[6rem] text-xs"
    />
  );
}

export function CustomerFilters({
  values,
  industries,
  grades,
  tags,
  owners,
  showOwner = true,
  disabled = false,
  hasActiveFilters,
  onChange,
  onReset,
}: CustomerFiltersProps): React.JSX.Element {
  const industryOptions = React.useMemo(
    () => [{ value: ALL, label: '全部行业' }, ...industries.map((item) => ({ value: item, label: item }))],
    [industries],
  );
  const tagOptions = React.useMemo(
    () => [{ value: ALL, label: '全部标签' }, ...tags.map((tag) => ({ value: tag, label: tag }))],
    [tags],
  );
  const ownerOptions = React.useMemo(
    () => [
      { value: ALL, label: '全部负责人' },
      { value: UNASSIGNED, label: '未分配' },
      ...owners.map((owner) => ({ value: owner.id, label: owner.name })),
    ],
    [owners],
  );

  return (
    <div className="flex flex-wrap items-center gap-2">
      <SearchInput
        value={values.search}
        onChange={(search) => onChange({ search })}
        placeholder="搜索姓名 / 公司 / 邮箱…"
        disabled={disabled}
        className="w-full sm:w-64 lg:w-72"
        aria-label="搜索客户"
      />

      <FilterSelect
        label="客户状态"
        value={values.status}
        options={STATUS_OPTIONS}
        onValueChange={(status) => onChange({ status: status as CustomerStatus | 'all' })}
        disabled={disabled}
      />

      <FilterSelect
        label="跟进"
        value={values.followUp}
        options={FOLLOW_UP_FILTER_OPTIONS}
        onValueChange={(followUp) => onChange({ followUp: followUp as FollowUpFilter })}
        disabled={disabled}
      />

      <FilterSelect
        label="标签"
        value={values.tag || ALL}
        options={tagOptions}
        onValueChange={(tag) => onChange({ tag: tag === ALL ? '' : tag })}
        disabled={disabled}
      />

      {showOwner ? (
        <FilterSelect
          label="负责人"
          value={values.ownerId}
          options={ownerOptions}
          onValueChange={(ownerId) => onChange({ ownerId })}
          disabled={disabled}
        />
      ) : null}

      <FilterSelect
        label="邮箱"
        value={values.hasEmail}
        options={EMAIL_OPTIONS}
        onValueChange={(hasEmail) => onChange({ hasEmail: hasEmail as HasEmailFilter })}
        disabled={disabled}
      />

      <FilterSelect
        label="行业"
        value={values.industry || ALL}
        options={industryOptions}
        onValueChange={(industry) => onChange({ industry: industry === ALL ? '' : industry })}
        disabled={disabled}
      />

      <FilterSelect
        label="来源"
        value={values.leadSource || ALL}
        options={CUSTOMER_LEAD_SOURCE_FILTER_OPTIONS}
        onValueChange={(leadSource) => onChange({ leadSource: leadSource === ALL ? '' : leadSource })}
        disabled={disabled}
      />

      <FilterSelect
        label="优先级"
        value={values.priority}
        options={CUSTOMER_PRIORITY_FILTER_OPTIONS}
        onValueChange={(priority) => onChange({ priority: priority as CustomerPriority | 'all' })}
        disabled={disabled}
      />

      {/* 等级数量有限且可能是自由文本，用输入框 + datalist 兼容任意值 */}
      <div className="relative">
        <GradeFilter value={values.grade} disabled={disabled} onChange={(grade) => onChange({ grade })} />
        <datalist id="customer-grade-options">
          {grades.map((grade) => (
            <option key={grade} value={grade} />
          ))}
        </datalist>
      </div>

      {hasActiveFilters ? (
        <Button type="button" variant="ghost" size="sm" onClick={onReset} disabled={disabled} className="h-8 text-xs">
          <FilterX className="h-3.5 w-3.5" aria-hidden />
          清空筛选
        </Button>
      ) : null}
    </div>
  );
}
