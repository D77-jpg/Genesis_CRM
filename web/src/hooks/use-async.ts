/**
 * 通用异步数据 Hook
 * ------------------------------------------------------------------
 * 处理三件容易出错的事：
 *  1. 组件卸载后不再 setState（避免 React 警告与内存泄漏）
 *  2. 依赖变化时的竞态：只采纳最后一次请求的结果
 *  3. 统一把异常转成中文提示
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { toErrorMessage } from '@/lib/api';

export interface UseAsyncOptions {
  /** 是否在挂载时立即执行，默认 true */
  immediate?: boolean;
  /** 请求失败时的兜底提示 */
  fallbackMessage?: string;
}

export interface UseAsyncResult<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  /** 手动重新执行 */
  run: () => Promise<T | null>;
  /** 直接写入缓存（乐观更新） */
  setData: (updater: T | null | ((prev: T | null) => T | null)) => void;
  /** 清空错误提示 */
  clearError: () => void;
}

export function useAsync<T>(
  task: () => Promise<T>,
  deps: unknown[] = [],
  options: UseAsyncOptions = {},
): UseAsyncResult<T> {
  const { immediate = true, fallbackMessage = '加载失败' } = options;

  const [data, setDataState] = useState<T | null>(null);
  const [loading, setLoading] = useState(immediate);
  const [error, setError] = useState<string | null>(null);

  // 始终持有最新的 task 闭包，调用方无需把它列进依赖
  const taskRef = useRef(task);
  taskRef.current = task;

  const mountedRef = useRef(true);
  const requestIdRef = useRef(0);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const run = useCallback(async (): Promise<T | null> => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setLoading(true);
    setError(null);

    try {
      const result = await taskRef.current();
      // 只有在「仍是最新一次请求」且组件仍挂载时才落地
      if (mountedRef.current && requestIdRef.current === requestId) {
        setDataState(result);
        setLoading(false);
      }
      return result;
    } catch (caught) {
      if (mountedRef.current && requestIdRef.current === requestId) {
        setError(toErrorMessage(caught, fallbackMessage));
        setLoading(false);
      }
      return null;
    }
  }, [fallbackMessage]);

  // 依赖数组序列化成字符串，既支持任意依赖又不会触发 lint 的展开告警
  const depsKey = JSON.stringify(deps);
  useEffect(() => {
    if (!immediate) return;
    void run();
  }, [immediate, run, depsKey]);

  const setData = useCallback((updater: T | null | ((prev: T | null) => T | null)) => {
    setDataState((prev) => (typeof updater === 'function' ? (updater as (p: T | null) => T | null)(prev) : updater));
  }, []);

  const clearError = useCallback(() => setError(null), []);

  return { data, loading, error, run, setData, clearError };
}
