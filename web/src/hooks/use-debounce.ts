/**
 * 防抖 Hook：搜索框输入 / 编辑器实时预览都会用到
 */
import { useCallback, useEffect, useRef, useState } from 'react';

/** 返回延迟 delay 毫秒后才更新的值 */
export function useDebouncedValue<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(timer);
  }, [value, delay]);

  return debounced;
}

/**
 * 返回防抖后的回调。
 * 组件卸载时自动清理未触发的定时器，避免在已卸载组件上执行副作用。
 */
export function useDebouncedCallback<A extends unknown[]>(
  callback: (...args: A) => void,
  delay = 300,
): ((...args: A) => void) & { cancel: () => void; flush: () => void } {
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  const timerRef = useRef<number | null>(null);
  const pendingArgs = useRef<A | null>(null);

  const clear = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  useEffect(() => clear, [clear]);

  const debounced = useCallback(
    (...args: A) => {
      pendingArgs.current = args;
      clear();
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        const latest = pendingArgs.current;
        pendingArgs.current = null;
        if (latest) callbackRef.current(...latest);
      }, delay);
    },
    [clear, delay],
  );

  const cancel = useCallback(() => {
    clear();
    pendingArgs.current = null;
  }, [clear]);

  const flush = useCallback(() => {
    if (timerRef.current === null) return;
    clear();
    const latest = pendingArgs.current;
    pendingArgs.current = null;
    if (latest) callbackRef.current(...latest);
  }, [clear]);

  return Object.assign(debounced, { cancel, flush });
}
