/// <reference types="vite/client" />

/**
 * 前端环境变量类型声明
 * 新增 VITE_ 变量时请在这里补类型，避免拼写错误静默失效。
 */
interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
  readonly VITE_API_PROXY_TARGET?: string;
  readonly VITE_APP_TITLE?: string;
  readonly VITE_TOKEN_STORAGE_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
