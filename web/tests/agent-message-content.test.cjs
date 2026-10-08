const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { buildSync } = require('esbuild');

const cache = path.resolve(__dirname, '../node_modules/.cache');
fs.mkdirSync(cache, { recursive: true });
const temporaryDirectory = fs.mkdtempSync(path.join(cache, 'agent-render-'));
const compiledPath = path.join(temporaryDirectory, 'component.cjs');
const build = buildSync({
  entryPoints: [path.resolve(__dirname, '../src/components/agent/agent-message-content.tsx')],
  bundle: true, platform: 'node', format: 'cjs', jsx: 'automatic', write: false,
  external: ['react', 'react/jsx-runtime'],
});
fs.writeFileSync(compiledPath, build.outputFiles[0].contents);
const { AgentMessageContent } = require(compiledPath);
const render = (content) => renderToStaticMarkup(React.createElement(AgentMessageContent, { content }));
after(() => { fs.unlinkSync(compiledPath); fs.rmdirSync(temporaryDirectory); });

test('assistant capability reply renders emphasis, headings, lists and a semantic table', () => {
  const html = render('## 能做的\n\n我是 **业务助手**。\n\n| 能力 | 说明 |\n| --- | --- |\n| 客户档案 | 只读查询 |\n\n- 第一步\n- 第二步');
  assert.match(html, /<h2>能做的<\/h2>/);
  assert.match(html, /<strong>业务助手<\/strong>/);
  assert.match(html, /role="region" aria-label="回复中的表格" tabindex="0"/);
  assert.match(html, /<table><thead><tr><th>能力<\/th>/);
  assert.match(html, /<td>客户档案<\/td>/);
  assert.match(html, /<ul>\s*<li>第一步<\/li>/);
  assert.doesNotMatch(html, /\| --- |\*\*业务助手/);
});

test('model HTML, event handlers and executable URLs cannot become active markup', () => {
  const html = render('<script>alert(1)</script>\n\n<img src="x" onerror="alert(2)">\n\n[坏链接](javascript:alert%281%29)\n\n[安全链接](https://example.com)');
  assert.doesNotMatch(html, /<script|<img|onerror|href="javascript:/i);
  assert.match(html, /href="https:\/\/example.com" target="_blank" rel="noopener noreferrer"/);
});

test('code stays literal and remote images remain descriptions', () => {
  const html = render('```html\n<script>alert(1)</script>\n```\n\n![示意图](https://example.com/tracker.png)');
  assert.match(html, /<pre><code/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /图片：示意图/);
  assert.doesNotMatch(html, /<img|src="https:/);
});
