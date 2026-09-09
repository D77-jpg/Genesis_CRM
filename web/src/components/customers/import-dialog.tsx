/**
 * Excel 导入向导
 * ------------------------------------------------------------------
 * 三步流程：
 *   1. 选择文件（拖拽 / 点击 / 下载模板）—— 浏览器端用 xlsx 解析，不上传文件
 *   2. 选择工作表 + 列映射 + 数据检查 + 导入设置
 *   3. 导入结果（新增 / 更新 / 跳过 / 失败明细）
 *
 * 解析与校验都在前端完成，用户在提交前就能看到「将会导入什么」，
 * 后端仍会用 zod 做权威校验，失败行会通过 __row 精确定位。
 */
import * as React from 'react';
import { toast } from 'sonner';
import {
  CheckCircle2,
  FileSpreadsheet,
  FileUp,
  Loader2,
  RotateCcw,
  StepForward,
  TriangleAlert,
  Upload,
} from 'lucide-react';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Separator } from '@/components/ui/separator';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ColumnMapper, ImportPreview } from './column-mapper';
import { downloadFile } from '@/lib/download';
import { formatFileSize } from '@/lib/format';
import { toErrorMessage } from '@/lib/api';
import {
  MAX_IMPORT_FILE_SIZE,
  MAX_IMPORT_ROWS,
  applyMapping,
  autoMapColumns,
  countMappedFields,
  readWorkbookFile,
  validateSpreadsheetFile,
  type ColumnMapping,
  type MappingResult,
  type ParsedSheet,
  type ParsedWorkbook,
} from '@/lib/excel';
import { useCustomerStore } from '@/store/customer.store';
import { cn } from '@/lib/utils';
import { CUSTOMER_STATUS_OPTIONS } from '@/constants';
import type { CustomerStatus, ImportResult } from '@/types';

type Step = 'file' | 'map' | 'done';

export interface ImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** 步骤指示器 */
function StepIndicator({ step }: { step: Step }): React.JSX.Element {
  const steps: { key: Step; label: string }[] = [
    { key: 'file', label: '选择文件' },
    { key: 'map', label: '列映射与检查' },
    { key: 'done', label: '导入结果' },
  ];
  const currentIndex = steps.findIndex((item) => item.key === step);

  return (
    <ol className="flex items-center gap-2 text-xs" aria-label="导入步骤">
      {steps.map((item, index) => {
        const state = index < currentIndex ? 'done' : index === currentIndex ? 'current' : 'todo';
        return (
          <li key={item.key} className="flex items-center gap-2">
            <span
              className={cn(
                'flex h-5 w-5 items-center justify-center rounded-full border text-2xs font-semibold tabular-nums',
                state === 'done' && 'border-status-developed bg-status-developed/10 text-status-developed',
                state === 'current' && 'border-primary bg-primary text-primary-foreground',
                state === 'todo' && 'border-border text-muted-foreground',
              )}
              aria-current={state === 'current' ? 'step' : undefined}
            >
              {index + 1}
            </span>
            <span className={cn(state === 'todo' ? 'text-muted-foreground' : 'font-medium')}>{item.label}</span>
            {index < steps.length - 1 ? <Separator orientation="vertical" className="h-3 w-px" /> : null}
          </li>
        );
      })}
    </ol>
  );
}

export function ImportDialog({ open, onOpenChange }: ImportDialogProps): React.JSX.Element {
  const importCustomers = useCustomerStore((state) => state.importCustomers);
  const mutating = useCustomerStore((state) => state.mutating);

  const [step, setStep] = React.useState<Step>('file');
  const [workbook, setWorkbook] = React.useState<ParsedWorkbook | null>(null);
  const [sheetName, setSheetName] = React.useState('');
  const [mapping, setMapping] = React.useState<ColumnMapping>({});
  const [parsing, setParsing] = React.useState(false);
  const [parseError, setParseError] = React.useState<string | null>(null);
  const [dragging, setDragging] = React.useState(false);
  const [downloadingTemplate, setDownloadingTemplate] = React.useState(false);

  const [onDuplicate, setOnDuplicate] = React.useState<'skip' | 'update'>('skip');
  const [defaultStatus, setDefaultStatus] = React.useState<CustomerStatus>('pending');
  const [importResult, setImportResult] = React.useState<ImportResult | null>(null);

  const fileInputRef = React.useRef<HTMLInputElement | null>(null);

  const sheet: ParsedSheet | null = React.useMemo(
    () => workbook?.sheets.find((item) => item.name === sheetName) ?? workbook?.sheets[0] ?? null,
    [workbook, sheetName],
  );

  // 映射结果随「工作表 / 映射 / 默认状态」变化实时重算（纯前端计算，无网络开销）
  const mappingResult: MappingResult | null = React.useMemo(() => {
    if (!sheet || countMappedFields(mapping) === 0) return null;
    return applyMapping(sheet.rows, mapping, defaultStatus);
  }, [sheet, mapping, defaultStatus]);

  const reset = React.useCallback(() => {
    setStep('file');
    setWorkbook(null);
    setSheetName('');
    setMapping({});
    setParseError(null);
    setImportResult(null);
    setOnDuplicate('skip');
    setDefaultStatus('pending');
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, []);

  // 关闭时清理，下次打开是干净的第一步
  React.useEffect(() => {
    if (!open) reset();
  }, [open, reset]);

  /* ---------------------------- 文件解析 ---------------------------- */

  const handleFile = React.useCallback(async (file: File) => {
    setParseError(null);

    const invalid = validateSpreadsheetFile(file);
    if (invalid) {
      setParseError(invalid);
      return;
    }

    setParsing(true);
    try {
      const parsed = await readWorkbookFile(file);
      if (parsed.sheets.length === 0) {
        setParseError('文件里没有可用的工作表，请确认内容后重试');
        return;
      }

      const first = parsed.sheets[0];
      if (first.rows.length === 0) {
        setParseError(`工作表「${first.name}」没有数据行`);
        return;
      }

      setWorkbook(parsed);
      setSheetName(first.name);
      setMapping(autoMapColumns(first.headers));
      setStep('map');
      toast.success('文件解析完成', {
        description: `${parsed.fileName} · ${first.rows.length.toLocaleString('zh-CN')} 行`,
      });
    } catch (error) {
      setParseError(toErrorMessage(error, '文件解析失败，请确认文件格式是否损坏'));
    } finally {
      setParsing(false);
    }
  }, []);

  const handleSheetChange = React.useCallback(
    (name: string) => {
      setSheetName(name);
      const target = workbook?.sheets.find((item) => item.name === name);
      // 换工作表后表头变了，重新做一次自动识别
      setMapping(target ? autoMapColumns(target.headers) : {});
    },
    [workbook],
  );

  const handleAutoMap = React.useCallback(() => {
    if (!sheet) return;
    setMapping(autoMapColumns(sheet.headers));
    toast.info('已重新识别列映射', { description: '如有偏差可继续手动调整' });
  }, [sheet]);

  const downloadTemplate = React.useCallback(async () => {
    setDownloadingTemplate(true);
    try {
      await downloadFile('/customers/template', '客户导入模板.xlsx');
      toast.success('模板已下载', { description: '按模板填写后可直接导入' });
    } catch (error) {
      toast.error('模板下载失败', { description: error instanceof Error ? error.message : undefined });
    } finally {
      setDownloadingTemplate(false);
    }
  }, []);

  /* ---------------------------- 提交导入 ---------------------------- */

  const submitImport = React.useCallback(async () => {
    if (!mappingResult || mappingResult.customers.length === 0) return;

    try {
      const result = await importCustomers({
        customers: mappingResult.customers,
        onDuplicate,
        defaultStatus,
        dryRun: false,
      });
      if (!result) throw new Error('导入未返回结果');

      setImportResult(result);
      setStep('done');

      const summary = `新增 ${result.created} 条，更新 ${result.updated} 条，跳过 ${result.skipped} 条`;
      if (result.failures.length > 0) {
        toast.warning('导入完成，但部分行失败', { description: `${summary}；失败 ${result.failures.length} 条` });
      } else {
        toast.success('导入完成', { description: summary });
      }
    } catch (error) {
      toast.error('导入失败', { description: toErrorMessage(error, 'Excel 导入失败') });
    }
  }, [mappingResult, importCustomers, onDuplicate, defaultStatus]);

  const handleOpenChange = React.useCallback(
    (next: boolean) => {
      if (mutating || parsing) return;
      onOpenChange(next);
    },
    [mutating, parsing, onOpenChange],
  );

  const canSubmit = Boolean(mappingResult && mappingResult.customers.length > 0 && !mutating);
  const missingNameColumn = Boolean(sheet && !mapping.name);

  /* ---------------------------- 渲染 ---------------------------- */

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Upload className="h-4 w-4 text-primary" aria-hidden />
            从 Excel 导入客户
          </DialogTitle>
          <DialogDescription>
            支持 .xlsx / .xls / .csv / .ods，单文件不超过 {Math.round(MAX_IMPORT_FILE_SIZE / 1024 / 1024)} MB，单次最多{' '}
            {MAX_IMPORT_ROWS.toLocaleString('zh-CN')} 行。文件在浏览器本地解析，不会上传原始文件。
          </DialogDescription>
          <div className="pt-1">
            <StepIndicator step={step} />
          </div>
        </DialogHeader>

        <DialogBody className="space-y-4">
          {/* ---------------- 第一步：选择文件 ---------------- */}
          {step === 'file' && (
            <div className="space-y-4">
              <div
                onDragOver={(event) => {
                  event.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={(event) => {
                  event.preventDefault();
                  setDragging(false);
                  const file = event.dataTransfer.files?.[0];
                  if (file) void handleFile(file);
                }}
                className={cn(
                  'flex flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed px-6 py-12 text-center transition-colors',
                  dragging ? 'border-primary bg-primary/5' : 'border-border bg-muted/20',
                )}
              >
                {parsing ? (
                  <>
                    <Loader2 className="h-8 w-8 animate-spin text-primary" aria-hidden />
                    <p className="text-sm font-medium">正在解析文件…</p>
                  </>
                ) : (
                  <>
                    <FileUp className="h-8 w-8 text-muted-foreground" strokeWidth={1.5} aria-hidden />
                    <div>
                      <p className="text-sm font-medium">把 Excel 文件拖到这里，或</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        会自动识别中英文表头（姓名 / Name、公司 / Company、邮箱 / Email 等）
                      </p>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={parsing}
                    >
                      <FileSpreadsheet className="h-3.5 w-3.5" aria-hidden />
                      选择文件
                    </Button>
                  </>
                )}

                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".xlsx,.xlsm,.xls,.csv,.ods"
                  className="sr-only"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) void handleFile(file);
                    event.target.value = '';
                  }}
                />
              </div>

              {parseError ? (
                <Alert variant="destructive">
                  <TriangleAlert aria-hidden />
                  <AlertTitle>无法读取文件</AlertTitle>
                  <AlertDescription>{parseError}</AlertDescription>
                </Alert>
              ) : null}

              <Separator />

              <div className="flex flex-col gap-2 rounded-md bg-muted/40 p-3 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0 space-y-1">
                  <p className="font-medium text-foreground">还没有整理好的表格？</p>
                  <p>下载导入模板，按列填写后直接导入即可。模板已内置中英文双语表头与示例行。</p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="shrink-0"
                  onClick={() => void downloadTemplate()}
                  loading={downloadingTemplate}
                >
                  {!downloadingTemplate ? <FileSpreadsheet className="h-3.5 w-3.5" aria-hidden /> : null}
                  下载模板
                </Button>
              </div>
            </div>
          )}

          {/* ---------------- 第二步：列映射与检查 ---------------- */}
          {step === 'map' && workbook && sheet && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{workbook.fileName}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {formatFileSize(workbook.fileSize)} · {workbook.sheets.length} 个工作表 · 当前表「{sheet.name}」
                    {sheet.rows.length.toLocaleString('zh-CN')} 行
                  </p>
                </div>

                {workbook.sheets.length > 1 && (
                  <div className="flex items-center gap-2">
                    <Label htmlFor="import-sheet" className="text-xs text-muted-foreground">
                      工作表
                    </Label>
                    <Select value={sheet.name} onValueChange={handleSheetChange}>
                      <SelectTrigger id="import-sheet" className="h-8 w-40 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {workbook.sheets.map((item) => (
                          <SelectItem key={item.name} value={item.name} className="text-xs">
                            {item.name}（{item.rows.length}）
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>

              {missingNameColumn ? (
                <Alert variant="warning">
                  <TriangleAlert aria-hidden />
                  <AlertTitle>请先映射「姓名」列</AlertTitle>
                  <AlertDescription>姓名是唯一必填字段，映射后才能继续导入。</AlertDescription>
                </Alert>
              ) : null}

              <div className="rounded-md border p-3">
                <ColumnMapper
                  headers={sheet.headers}
                  mapping={mapping}
                  onMappingChange={setMapping}
                  onAutoMap={handleAutoMap}
                  disabled={mutating}
                />
              </div>

              {mappingResult ? <ImportPreview sheet={sheet} mapping={mapping} result={mappingResult} /> : null}

              <Separator />

              {/* 导入设置 */}
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <Label htmlFor="import-duplicate" className="text-xs">
                    重复数据处理
                  </Label>
                  <Select
                    value={onDuplicate}
                    onValueChange={(value) => setOnDuplicate(value as 'skip' | 'update')}
                    disabled={mutating}
                  >
                    <SelectTrigger id="import-duplicate" className="mt-1.5 h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="skip" className="text-xs">
                        跳过已存在的客户
                      </SelectItem>
                      <SelectItem value="update" className="text-xs">
                        覆盖更新已存在的客户
                      </SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="mt-1 text-2xs leading-relaxed text-muted-foreground">
                    有邮箱时按邮箱判重，无邮箱时按「姓名 + 公司」判重。
                  </p>
                </div>

                <div>
                  <Label htmlFor="import-status" className="text-xs">
                    默认开发状态
                  </Label>
                  <Select
                    value={defaultStatus}
                    onValueChange={(value) => setDefaultStatus(value as CustomerStatus)}
                    disabled={mutating}
                  >
                    <SelectTrigger id="import-status" className="mt-1.5 h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CUSTOMER_STATUS_OPTIONS.map((option) => (
                        <SelectItem key={option.value} value={option.value} className="text-xs">
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="mt-1 text-2xs leading-relaxed text-muted-foreground">
                    仅对 Excel 中「状态」列为空或未识别的行生效。
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* ---------------- 第三步：结果 ---------------- */}
          {step === 'done' && importResult && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <ResultTile label="提交行数" value={importResult.total} />
                <ResultTile label="新增客户" value={importResult.created} tone="positive" />
                <ResultTile label="更新客户" value={importResult.updated} tone="positive" />
                {/* 后端的 skipped 已经把 failures 计进去了，这里不能再加一次 */}
                <ResultTile
                  label="跳过 / 失败"
                  value={importResult.skipped}
                  tone={importResult.failures.length > 0 ? 'negative' : 'default'}
                />
              </div>

              {importResult.failures.length > 0 ? (
                <div className="space-y-2">
                  <p className="flex items-center gap-1.5 text-xs font-medium">
                    <TriangleAlert className="h-3.5 w-3.5 text-destructive" aria-hidden />
                    以下 {importResult.failures.length} 行未能导入
                  </p>
                  <div className="max-h-64 overflow-y-auto rounded-md border">
                    <Table>
                      <TableHeader>
                        <TableRow className="hover:bg-transparent">
                          <TableHead className="w-16">行号</TableHead>
                          <TableHead>姓名</TableHead>
                          <TableHead>邮箱</TableHead>
                          <TableHead>原因</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {importResult.failures.map((failure, index) => (
                          <TableRow key={`${failure.row ?? 'x'}-${index}`}>
                            <TableCell className="text-xs tabular-nums text-muted-foreground">
                              {failure.row ?? '—'}
                            </TableCell>
                            <TableCell className="max-w-[10rem] truncate text-xs">{failure.name || '—'}</TableCell>
                            <TableCell className="max-w-[12rem] truncate text-xs">{failure.email || '—'}</TableCell>
                            <TableCell className="text-xs text-destructive">{failure.reason}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              ) : (
                <Alert variant="success">
                  <CheckCircle2 aria-hidden />
                  <AlertTitle>全部导入成功</AlertTitle>
                  <AlertDescription>客户列表已刷新，可以直接开始发送开发信。</AlertDescription>
                </Alert>
              )}
            </div>
          )}
        </DialogBody>

        <DialogFooter>
          {step === 'file' && (
            <Button type="button" variant="outline" onClick={() => handleOpenChange(false)} disabled={parsing}>
              取消
            </Button>
          )}

          {step === 'map' && (
            <>
              <Button type="button" variant="ghost" onClick={reset} disabled={mutating}>
                <RotateCcw className="h-3.5 w-3.5" aria-hidden />
                重新选择文件
              </Button>
              <Button
                type="button"
                onClick={() => void submitImport()}
                loading={mutating}
                disabled={!canSubmit || missingNameColumn}
              >
                {!mutating ? <StepForward className="h-3.5 w-3.5" aria-hidden /> : null}
                导入 {mappingResult?.customers.length ?? 0} 条客户
              </Button>
            </>
          )}

          {step === 'done' && (
            <>
              <Button type="button" variant="outline" onClick={reset} disabled={mutating}>
                <RotateCcw className="h-3.5 w-3.5" aria-hidden />
                继续导入
              </Button>
              <Button type="button" onClick={() => handleOpenChange(false)}>
                完成
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ResultTile({
  label,
  value,
  tone = 'default',
}: {
  label: string;
  value: number;
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
      <p className={cn('mt-0.5 text-lg font-semibold tabular-nums', toneClass)}>{value.toLocaleString('zh-CN')}</p>
    </div>
  );
}
