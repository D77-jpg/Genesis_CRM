/**
 * 前端入口
 * ------------------------------------------------------------------
 * StrictMode 在开发环境会双调用 effect，能提前暴露「重复请求」与
 * 「未清理的副作用」问题；生产构建不受影响。
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './index.css';

const container = document.getElementById('root');

if (!container) {
  // index.html 被改坏时给出明确提示，而不是静默白屏
  throw new Error('找不到 #root 挂载节点，请检查 web/index.html');
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
