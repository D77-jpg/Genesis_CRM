/**
 * 搜索框：受控输入 + 防抖回调 + 一键清空
 * ------------------------------------------------------------------
 * 内部维护即时输入值，父组件只接收防抖后的值，
 * 避免每敲一个字就发一次请求。
 */
import * as React from 'react';
import { Search, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { useDebouncedValue } from '@/hooks/use-debounce';
import { cn } from '@/lib/utils';

export interface SearchInputProps {
  /** 防抖后的值（父级持有） */
  value: string;
  /** 防抖后触发 */
  onChange: (value: string) => void;
  placeholder?: string;
  /** 防抖延迟，默认 350ms */
  delay?: number;
  className?: string;
  disabled?: boolean;
  'aria-label'?: string;
}

export function SearchInput({
  value,
  onChange,
  placeholder = '搜索…',
  delay = 350,
  className,
  disabled = false,
  ...props
}: SearchInputProps): React.JSX.Element {
  const [keyword, setKeyword] = React.useState(value);
  const debounced = useDebouncedValue(keyword, delay);

  /**
   * 我们最后一次上报给父级的值。
   * 用来区分「自己发出去又回流下来的值」与「父级主动重置的值」：
   * 前者不能去覆盖输入框（否则会把用户正在敲的字吃掉），后者才需要同步。
   */
  const emittedRef = React.useRef(value);

  /**
   * 输入框当前值的同步镜像。
   * state 在同一轮 effect 里还是旧值，而 ref 可以跨 effect 立即传递，
   * 用于丢弃「已被重置作废、但还在途的旧防抖值」。
   */
  const keywordRef = React.useRef(keyword);
  keywordRef.current = keyword;

  // 父级主动改值（例如「清空筛选」按钮直接写 store）→ 同步回输入框
  React.useEffect(() => {
    if (value === emittedRef.current) return;
    emittedRef.current = value;
    if (keywordRef.current === value) return;
    keywordRef.current = value;
    setKeyword(value);
  }, [value]);

  // 防抖后上报父级：防抖值必须已经追上输入框当前值，
  // 否则说明它是被重置作废掉的旧值，直接丢弃（不能回推给父级）
  React.useEffect(() => {
    if (debounced !== keywordRef.current) return;
    if (debounced === emittedRef.current) return;
    emittedRef.current = debounced;
    onChange(debounced);
  }, [debounced, onChange]);

  /** 立即上报，不等防抖（清空按钮与回车共用） */
  const emitNow = React.useCallback(
    (next: string) => {
      keywordRef.current = next;
      setKeyword(next);
      if (emittedRef.current === next) return;
      emittedRef.current = next;
      onChange(next);
    },
    [onChange],
  );

  const clear = React.useCallback(() => emitNow(''), [emitNow]);

  return (
    <div className={cn('relative', className)}>
      <Search
        className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
        aria-hidden
      />
      <Input
        {...props}
        type="search"
        value={keyword}
        disabled={disabled}
        onChange={(event) => setKeyword(event.target.value)}
        onKeyDown={(event) => {
          // 回车立即搜索，不等防抖
          if (event.key === 'Enter') {
            event.preventDefault();
            emitNow(keyword);
          }
          if (event.key === 'Escape' && keyword) {
            event.preventDefault();
            clear();
          }
        }}
        placeholder={placeholder}
        className={cn('h-8 pl-8 pr-8 text-sm', keyword && 'pr-8')}
      />
      {keyword ? (
        <button
          type="button"
          onClick={clear}
          disabled={disabled}
          aria-label="清空搜索"
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded-sm p-0.5 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      ) : null}
    </div>
  );
}
