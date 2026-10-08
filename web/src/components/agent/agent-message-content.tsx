import * as React from 'react';
import Markdown from 'react-markdown';
import type { Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';

const components: Components = {
  table: ({ children }) => (
    <div className="agent-message-table" role="region" aria-label="回复中的表格" tabIndex={0}>
      <table>{children}</table>
    </div>
  ),
  a: ({ children, href }) => href ? (
    <a href={href} target={href.startsWith('#') ? undefined : '_blank'} rel="noopener noreferrer">{children}</a>
  ) : <span>{children}</span>,
  // Model replies are text; keep image descriptions without requesting remote assets.
  img: ({ alt }) => <span className="text-muted-foreground">{alt ? `[图片：${alt}]` : '[图片]'}</span>,
};

export function AgentMessageContent({ content }: { content: string }): React.JSX.Element {
  return (
    <div className="agent-message-content">
      <Markdown remarkPlugins={[remarkGfm]} components={components} skipHtml>{content}</Markdown>
    </div>
  );
}
