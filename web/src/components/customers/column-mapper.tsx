/**
 * 列映射界面 + 导入预览
 * ------------------------------------------------------------------
 * ColumnMapper：为每个目标字段指定 Excel 列（自动识别的结果可再手工修正）。
 * ImportPreview：展示映射后的真实数据前几行 + 行级问题清单，
 *                让用户在提交前就能确认「解析结果 = 期望结果」。
 */
import * as React from 'react';
import { AlertCircle, ArrowRight, CheckCircle2, Table2, TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { CustomerStatusBadge } from '@/components/common/status-badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { CUSTOMER_STATUS_LABEL, IMPORT_FIELDS } from '@/constants';
import { MAPPING_PREVIEW_ROWS, sortIssues, type ColumnMapping, type MappingResult, type ParsedSheet } from '@/lib/excel';
import { cn } from '@/lib/utils';
import type { CustomerStatus, ImportField } from '@/types';

/** Select 里表示「不导入该字段」的值（Radix 不允许 value=""） */
const NONE = '__none__';

/* ------------------------------------------------------------------ */
/* 列映射                                                              */
/* ------------------------------------------------------------------ */

export interface ColumnMapperProps {
  /** 当前工作表的所有表头 */
  headers: string[];
  mapping: ColumnMapping;
  onMappingChange: (mapping: ColumnMapping) => void;
  /** 重新执行一次自动识别 */
  onAutoMap: () => void;
  disabled?: boolean;
}

export function ColumnMapper({
  headers,
  mapping,
  onMappingChange,
  onAutoMap,
  disabled = false,
}: ColumnMapperProps): React.JSX.Element {
  const setField = React.useCallback(
    (field: ImportField, header: string) => {
      const next: ColumnMapping = { ...mapping };
      if (header === NONE) {
        delete next[field];
      } else {
        // 一列只能给一个字段：把之前占用该列的字段清掉，避免重复导入
        for (const [key, value] of Object.entries(next)) {
          if (value === header) delete next[key as ImportField];
        }
        next[field] = header;
      }
      onMappingChange(next);
    },
    [mapping, onMappingChange],
  );

  const headerOptions = React.useMemo(
    () => headers.map((header) => ({ value: header, label: header })),
    [headers],
  );

  const mappedCount = Object.values(mapping).filter(Boolean).length;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <ArrowRight className="h-3.5 w-3.5" aria-hidden />
          左侧是系统字段，右侧选择对应的 Excel 列；已自动识别 {mappedCount} / {IMPORT_FIELDS.length} 个字段
        </p>
        <Button type="button" variant="outline" size="sm" onClick={onAutoMap} disabled={disabled}>
          重新自动识别
        </Button>
      </div>

      <div className="grid gap-x-4 gap-y-2.5 sm:grid-cols-2">
        {IMPORT_FIELDS.map((def) => {
          const value = mapping[def.field];
          return (
            <div key={def.field} className="flex items-center gap-2">
              <div className="flex min-w-0 flex-1 items-center gap-1.5">
                <span className={cn('truncate text-xs font-medium', def.required ? 'text-foreground' : 'text-muted-foreground')}>
                  {def.label}
                </span>
                {def.required ? <span className="text-xs text-destructive">*</span> : null}
                <span className="truncate text-2xs text-muted-foreground/70">{def.labelEn}</span>
              </div>

              <Select value={value ?? NONE} onValueChange={(next) => setField(def.field, next)} disabled={disabled}>
                <SelectTrigger
                  className={cn('h-8 w-40 shrink-0 text-xs', !value && def.required && 'border-destructive/50')}
                  aria-label={`${def.label} 对应的 Excel 列`}
                >
                  <SelectValue placeholder="请选择列" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE} className="text-xs text-muted-foreground">
                    不导入
                  </SelectItem>
                  {headerOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value} className="max-w-[16rem] truncate text-xs">
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          );
        })}
      </div>

      <Separator />

      <p className="text-2xs leading-relaxed text-muted-foreground">
        提示：Excel 中的日期、数字会统一转成文本再入库；「状态」列接受 待开发 / 已开发 / pending / developed，
        留空时按下方导入设置里的默认状态处理。
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 映射结果预览                                                        */
/* ------------------------------------------------------------------ */

export interface ImportPreviewProps {
  sheet: ParsedSheet;
  mapping: ColumnMapping;
  result: MappingResult;
}

/** 预览表格里要展示的字段（顺序即列顺序） */
const PREVIEW_FIELDS = IMPORT_FIELDS.filter((def) => def.field !== 'tags');

export function ImportPreview({ sheet, mapping, result }: ImportPreviewProps): React.JSX.Element {
  const columns = React.useMemo(
    () => PREVIEW_FIELDS.filter((def) => Boolean(mapping[def.field])),
    [mapping],
  );

  const previewRows = React.useMemo(() => result.customers.slice(0, MAPPING_PREVIEW_ROWS), [result.customers]);
  const issues = React.useMemo(() => sortIssues(result.issues, 30), [result.issues]);
  const { stats } = result;

  return (
    <div className="space-y-4">
      {/* 统计摘要 */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <SummaryTile label="工作表总行数" value={sheet.rows.length} />
        <SummaryTile label="可导入" value={stats.validRows} tone="positive" />
        <SummaryTile label="被跳过（缺少必填）" value={stats.invalidRows} tone={stats.invalidRows > 0 ? 'negative' : 'default'} />
        <SummaryTile label="含邮箱 / 无邮箱" value={`${stats.withEmail} / ${stats.withoutEmail}`} />
      </div>

      {sheet.truncated ? (
        <p className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
          该工作表行数较多，仅解析了前 {sheet.rows.length.toLocaleString('zh-CN')} 行。如需导入全部数据，请拆分成多个文件后分批导入。
        </p>
      ) : null}

      {Object.values(stats.byStatus).some((count) => count > 0) ? (
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span>状态分布：</span>
          {Object.entries(stats.byStatus)
            .filter(([, count]) => count > 0)
            .map(([status, count]) => (
              <span key={status} className="inline-flex items-center gap-1">
                <CustomerStatusBadge status={status as CustomerStatus} showDot={false} />
                <span className="tabular-nums">{count}</span>
              </span>
            ))}
        </div>
      ) : null}

      {/* 映射结果预览 */}
      <div className="space-y-2">
        <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <Table2 className="h-3.5 w-3.5" aria-hidden />
          映射结果预览（前 {previewRows.length} 行）
        </p>

        {previewRows.length === 0 ? (
          <p className="rounded-md border border-dashed px-3 py-6 text-center text-xs text-muted-foreground">
            没有可导入的数据行，请检查「姓名」列是否映射正确
          </p>
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="w-16">行号</TableHead>
                  {columns.map((def) => (
                    <TableHead key={def.field} className="max-w-[12rem]">
                      <span className="flex items-center gap-1">
                        {def.label}
                        <span className="truncate text-2xs font-normal normal-case text-muted-foreground/70">
                          ← {mapping[def.field]}
                        </span>
                      </span>
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {previewRows.map((row) => (
                  <TableRow key={row.__row}>
                    <TableCell className="text-xs tabular-nums text-muted-foreground">{row.__row}</TableCell>
                    {columns.map((def) => (
                      <TableCell key={def.field} className="max-w-[12rem] truncate text-xs">
                        {def.field === 'status'
                          ? (row.status ? (CUSTOMER_STATUS_LABEL[row.status] ?? row.status) : '—')
                          : ((row[def.field] as string | undefined) ?? '—')}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      {/* 问题清单 */}
      {issues.length > 0 ? (
        <div className="space-y-2">
          <p className="flex items-center gap-1.5 text-xs font-medium">
            <TriangleAlert className="h-3.5 w-3.5 text-amber-500" aria-hidden />
            数据检查（{stats.errorCount} 个错误，{stats.warningCount} 个提醒）
          </p>
          <ul className="max-h-52 space-y-1 overflow-y-auto rounded-md border bg-muted/40 p-2">
            {issues.map((issue, index) => (
              <li key={`${issue.row}-${issue.field}-${index}`} className="flex items-start gap-2 text-xs">
                {issue.level === 'error' ? (
                  <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" aria-hidden />
                ) : (
                  <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" aria-hidden />
                )}
                <span className="shrink-0 font-medium tabular-nums text-muted-foreground">
                  {issue.row > 0 ? `第 ${issue.row} 行` : '全局'}
                </span>
                <span className="min-w-0 break-words">{issue.message}</span>
              </li>
            ))}
          </ul>
          {result.issues.length > issues.length ? (
            <p className="text-2xs text-muted-foreground">
              仅显示前 {issues.length} 条，共 {result.issues.length} 条问题。
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function SummaryTile({
  label,
  value,
  tone = 'default',
}: {
  label: string;
  value: React.ReactNode;
  tone?: 'default' | 'positive' | 'negative';
}): React.JSX.Element {
  const toneClass = {
    default: 'text-foreground',
    positive: 'text-status-developed',
    negative: 'text-destructive',
  }[tone];

  return (
    <div className="rounded-md border bg-muted/30 px-3 py-2">
      <p className="truncate text-2xs text-muted-foreground">{label}</p>
      <p className={cn('mt-0.5 text-lg font-semibold tabular-nums', toneClass)}>{value}</p>
    </div>
  );
}
