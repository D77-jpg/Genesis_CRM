import * as React from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  CloudOff,
  Copy,
  Loader2,
  RefreshCw,
  StickyNote,
  Trash2,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useEscapeKey, useIsMobile } from '@/hooks/use-ui';
import { apiGet, apiPut, ApiClientError, toErrorMessage } from '@/lib/api';
import { copyToClipboard } from '@/lib/format';
import { readStorage, removeStorage, writeStorage } from '@/lib/utils';
import { SCRATCHPAD_MAX_LENGTH, SCRATCHPAD_PENDING_PREFIX } from '@/constants';
import { useAuthStore } from '@/store/auth.store';
import { useProjectStore } from '@/store/project.store';
import { useUiStore } from '@/store/ui.store';
import type { Scratchpad, UpdateScratchpadInput } from '@/types';

const AUTO_SAVE_DELAY = 1_000;

type SaveStatus = 'loading' | 'saved' | 'dirty' | 'saving' | 'offline' | 'conflict';

interface PendingDraft {
  content: string;
  baseVersion: number;
  savedAt: string;
}

function isPendingDraft(value: PendingDraft | null): value is PendingDraft {
  return Boolean(
    value
      && typeof value.content === 'string'
      && Number.isInteger(value.baseVersion)
      && value.baseVersion >= 0,
  );
}

function timeLabel(value: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
}

export function ScratchpadPanel(): React.JSX.Element | null {
  const user = useAuthStore((state) => state.user);
  const project = useProjectStore((state) => state.activeProject);
  const open = useUiStore((state) => state.scratchpadOpen);
  const setOpen = useUiStore((state) => state.setScratchpadOpen);
  const toggleOpen = useUiStore((state) => state.toggleScratchpad);
  const isMobile = useIsMobile();

  const [content, setContent] = React.useState('');
  const [status, setStatus] = React.useState<SaveStatus>('loading');
  const [lastSavedAt, setLastSavedAt] = React.useState<string | null>(null);
  const [clearOpen, setClearOpen] = React.useState(false);
  const [serverConflict, setServerConflict] = React.useState<Scratchpad | null>(null);

  const textareaRef = React.useRef<HTMLTextAreaElement>(null);
  const contentRef = React.useRef('');
  const versionRef = React.useRef(0);
  const serverContentRef = React.useRef('');
  const loadedRef = React.useRef(false);
  const savingRef = React.useRef(false);
  const saveTimerRef = React.useRef<number | null>(null);
  const saveRef = React.useRef<() => Promise<void>>(async () => undefined);

  const contextKey = user && project ? `${user.id}:${project.id}` : null;
  const pendingKey = contextKey ? `${SCRATCHPAD_PENDING_PREFIX}${contextKey}` : null;

  const clearSaveTimer = React.useCallback(() => {
    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
  }, []);

  const scheduleSave = React.useCallback((delay = AUTO_SAVE_DELAY) => {
    clearSaveTimer();
    saveTimerRef.current = window.setTimeout(() => void saveRef.current(), delay);
  }, [clearSaveTimer]);

  const loadLatest = React.useCallback(async (preservePending = true) => {
    if (!pendingKey) return;
    loadedRef.current = false;
    clearSaveTimer();
    setStatus('loading');
    setServerConflict(null);

    const data = await apiGet<Scratchpad>('/scratchpad');
    const pending = preservePending ? readStorage<PendingDraft | null>(pendingKey, null) : null;
    const hasPending = isPendingDraft(pending) && pending.content !== data.content;
    const nextContent = hasPending ? pending.content : data.content;

    contentRef.current = nextContent;
    versionRef.current = data.version;
    serverContentRef.current = data.content;
    setContent(nextContent);
    setLastSavedAt(data.updatedAt);
    loadedRef.current = true;

    if (hasPending && pending.baseVersion !== data.version) {
      setServerConflict(data);
      setStatus('conflict');
    } else if (hasPending) {
      setStatus('dirty');
      scheduleSave();
    } else {
      removeStorage(pendingKey);
      setStatus('saved');
    }
  }, [clearSaveTimer, pendingKey, scheduleSave]);

  React.useEffect(() => {
    if (!contextKey || !pendingKey) return;
    let cancelled = false;
    void loadLatest().catch((error) => {
      if (cancelled) return;
      const pending = readStorage<PendingDraft | null>(pendingKey, null);
      if (isPendingDraft(pending)) {
        contentRef.current = pending.content;
        versionRef.current = pending.baseVersion;
        serverContentRef.current = '';
        setContent(pending.content);
      } else {
        contentRef.current = '';
        versionRef.current = 0;
        serverContentRef.current = '';
        setContent('');
      }
      loadedRef.current = true;
      setStatus('offline');
      toast.error('随手记加载失败', { description: toErrorMessage(error) });
    });
    return () => {
      cancelled = true;
      loadedRef.current = false;
      clearSaveTimer();
    };
  }, [clearSaveTimer, contextKey, loadLatest, pendingKey]);

  const saveNow = React.useCallback(async () => {
    if (!loadedRef.current || !pendingKey || savingRef.current || serverConflict) return;
    const snapshot = contentRef.current;
    if (snapshot === serverContentRef.current) {
      removeStorage(pendingKey);
      setStatus('saved');
      return;
    }

    clearSaveTimer();
    savingRef.current = true;
    setStatus('saving');
    try {
      const payload: UpdateScratchpadInput = { content: snapshot, expectedVersion: versionRef.current };
      const saved = await apiPut<Scratchpad>('/scratchpad', payload);
      versionRef.current = saved.version;
      serverContentRef.current = snapshot;
      setLastSavedAt(saved.updatedAt);

      if (contentRef.current === snapshot) {
        removeStorage(pendingKey);
        setStatus('saved');
      } else {
        writeStorage(pendingKey, {
          content: contentRef.current,
          baseVersion: saved.version,
          savedAt: new Date().toISOString(),
        } satisfies PendingDraft);
        setStatus('dirty');
        scheduleSave();
      }
    } catch (error) {
      if (error instanceof ApiClientError && error.status === 409) {
        let latest: Scratchpad = { content: '', version: -1, updatedAt: null };
        try {
          latest = await apiGet<Scratchpad>('/scratchpad');
        } catch {
          /* 本机草稿仍在 pendingKey 中，不因二次读取失败而丢失。 */
        }
        setServerConflict(latest);
        setStatus('conflict');
      } else {
        setStatus('offline');
        scheduleSave(5_000);
      }
    } finally {
      savingRef.current = false;
    }
  }, [clearSaveTimer, pendingKey, scheduleSave, serverConflict]);

  saveRef.current = saveNow;

  React.useEffect(() => {
    contentRef.current = content;
    if (!loadedRef.current || !pendingKey || serverConflict || content === serverContentRef.current) return;
    writeStorage(pendingKey, {
      content,
      baseVersion: versionRef.current,
      savedAt: new Date().toISOString(),
    } satisfies PendingDraft);
    if (!savingRef.current) setStatus('dirty');
    scheduleSave();
  }, [content, pendingKey, scheduleSave, serverConflict]);

  React.useEffect(() => {
    const retryWhenOnline = () => {
      if (status === 'offline') void saveRef.current();
    };
    window.addEventListener('online', retryWhenOnline);
    return () => window.removeEventListener('online', retryWhenOnline);
  }, [status]);

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'm') {
        event.preventDefault();
        toggleOpen();
      }
      if (open && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        void saveRef.current();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, toggleOpen]);

  React.useEffect(() => {
    if (open) window.requestAnimationFrame(() => textareaRef.current?.focus());
  }, [open]);

  React.useEffect(() => {
    if (!isMobile || !open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [isMobile, open]);

  const closePanel = React.useCallback(() => {
    void saveRef.current();
    setOpen(false);
  }, [setOpen]);
  useEscapeKey(closePanel, open && !clearOpen);

  const handleCopy = async () => {
    if (!content) {
      toast.info('随手记当前为空');
      return;
    }
    const copied = await copyToClipboard(content);
    if (copied) toast.success('随手记已复制');
    else toast.error('复制失败', { description: '请手动选择内容复制' });
  };

  const handleClear = () => {
    setContent('');
    setClearOpen(false);
    window.requestAnimationFrame(() => textareaRef.current?.focus());
  };

  const loadServerVersion = () => {
    if (!serverConflict || serverConflict.version < 0 || !pendingKey) return;
    contentRef.current = serverConflict.content;
    versionRef.current = serverConflict.version;
    serverContentRef.current = serverConflict.content;
    setContent(serverConflict.content);
    setLastSavedAt(serverConflict.updatedAt);
    setServerConflict(null);
    removeStorage(pendingKey);
    setStatus('saved');
  };

  if (!open || !user || !project) return null;

  const statusView = (() => {
    if (status === 'loading') return { icon: Loader2, text: '正在加载…', className: 'animate-spin' };
    if (status === 'saving') return { icon: Loader2, text: '正在保存…', className: 'animate-spin' };
    if (status === 'dirty') return { icon: StickyNote, text: '等待自动保存', className: '' };
    if (status === 'offline') return { icon: CloudOff, text: '未同步，内容已暂存在本机', className: '' };
    if (status === 'conflict') return { icon: AlertTriangle, text: '发现其他设备的更新', className: '' };
    return { icon: CheckCircle2, text: lastSavedAt ? `已保存 ${timeLabel(lastSavedAt)}` : '已保存', className: '' };
  })();
  const StatusIcon = statusView.icon;

  return (
    <>
      <aside
        className="fixed inset-y-0 right-0 z-40 flex w-full flex-col border-l bg-background shadow-2xl sm:top-14 sm:w-[420px]"
        aria-label="个人随手记"
      >
        <div className="flex min-h-16 shrink-0 items-center gap-3 border-b px-4">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
            <StickyNote className="h-5 w-5" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-semibold">个人随手记</h2>
            <p className="truncate text-xs text-muted-foreground">{project.name} · 仅自己可见</p>
          </div>
          <Button type="button" variant="ghost" size="icon" onClick={closePanel} aria-label="关闭随手记">
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-3 p-4">
          <div className="flex items-center justify-between gap-3">
            <label htmlFor="personal-scratchpad" className="text-sm font-medium">临时记录</label>
            <span
              className={status === 'conflict' || status === 'offline' ? 'flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400' : 'flex items-center gap-1.5 text-xs text-muted-foreground'}
              aria-live="polite"
            >
              <StatusIcon className={`h-3.5 w-3.5 ${statusView.className}`} aria-hidden />
              {statusView.text}
            </span>
          </div>

          {status === 'conflict' && (
            <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm" role="alert">
              <p className="font-medium text-amber-700 dark:text-amber-300">内容没有被覆盖</p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                另一页面或设备保存了新版本。可先复制当前内容，再载入服务器版本进行整理。
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button type="button" size="sm" variant="outline" onClick={() => void handleCopy()}>
                  <Copy className="h-3.5 w-3.5" />复制当前内容
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={serverConflict && serverConflict.version >= 0 ? loadServerVersion : () => void loadLatest()}
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  {serverConflict && serverConflict.version >= 0 ? '载入服务器版本' : '重新检查'}
                </Button>
              </div>
            </div>
          )}

          <Textarea
            ref={textareaRef}
            id="personal-scratchpad"
            value={content}
            onChange={(event) => setContent(event.target.value)}
            maxLength={SCRATCHPAD_MAX_LENGTH}
            disabled={status === 'loading'}
            placeholder="可临时粘贴客户资料、网址、电话、邮件片段或待办信息……"
            className="min-h-0 flex-1 resize-none text-base leading-relaxed sm:text-sm"
            spellCheck
          />

          <div className="flex shrink-0 items-center justify-between gap-3">
            <span className="text-xs tabular-nums text-muted-foreground">
              {content.length.toLocaleString()} / {SCRATCHPAD_MAX_LENGTH.toLocaleString()}
            </span>
            <div className="flex items-center gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => void handleCopy()} disabled={!content}>
                <Copy className="h-3.5 w-3.5" />复制全部
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => setClearOpen(true)} disabled={!content}>
                <Trash2 className="h-3.5 w-3.5" />清空
              </Button>
            </div>
          </div>
        </div>
      </aside>

      <AlertDialog open={clearOpen} onOpenChange={setClearOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>清空当前随手记？</AlertDialogTitle>
            <AlertDialogDescription>
              清空后会自动同步到服务器。若内容仍有用，建议先复制保存到其他位置。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={handleClear}>
              确认清空
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
