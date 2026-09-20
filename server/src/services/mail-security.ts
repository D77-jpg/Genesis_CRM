import sanitizeHtml from 'sanitize-html';
import path from 'node:path';

export function safeMailHtml(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: ['p', 'br', 'div', 'span', 'strong', 'b', 'em', 'i', 'u', 's', 'blockquote', 'pre', 'code', 'ul', 'ol', 'li', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'h1', 'h2', 'h3', 'hr', 'a'],
    allowedAttributes: { a: ['href', 'title', 'rel', 'data-no-track'], '*': ['style'] },
    allowedStyles: { '*': {
      color: [/^#[0-9a-f]{3,8}$/i, /^rgba?\([\d\s.,%]+\)$/i, /^[a-z]+$/i],
      'background-color': [/^#[0-9a-f]{3,8}$/i, /^rgba?\([\d\s.,%]+\)$/i, /^[a-z]+$/i],
      'text-align': [/^(left|right|center|justify)$/],
      'font-family': [/^[a-z0-9\s,'"_-]+$/i],
      'font-size': [/^\d{1,3}(px|pt|em|rem|%)$/],
      'line-height': [/^\d{1,3}(\.\d+)?(px|pt|em|rem|%)?$/],
      'margin-bottom': [/^\d{1,3}(px|pt|em|rem)$/],
    } },
    allowedSchemes: ['https', 'http', 'mailto'],
    allowProtocolRelative: false,
    // Only inert typography styles; no remote images, CSS URLs, forms or scripts.
  });
}

export function normalizeSubject(subject: string): string {
  return subject.replace(/^(\s*(re|fw|fwd|回复|答复|转发)\s*[:：]\s*)+/i, '').trim().toLowerCase();
}

export function attachmentAllowed(name: string, mime: string, data: Buffer, limit: number): boolean {
  if (!data.length || data.length > limit || /[\x00-\x1f]/.test(name)) return false;
  const ext = path.extname(name).toLowerCase();
  if (ext === '.txt') return mime === 'text/plain' && !data.includes(0);
  if (ext === '.pdf') return mime === 'application/pdf' && data.subarray(0, 5).toString() === '%PDF-';
  if (ext === '.png') return mime === 'image/png' && data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (ext === '.jpg' || ext === '.jpeg') return mime === 'image/jpeg' && data[0] === 255 && data[1] === 216 && data[2] === 255;
  return false;
}

// Error messages from network libraries may contain credentials/server responses.
// Only allow a fixed vocabulary to reach persistence, APIs or logs.
export function mailError(error: unknown, protocol: 'SMTP' | 'IMAP'): string {
  const e = error as { code?: string; authenticationFailed?: boolean };
  if (e?.code === 'EAUTH' || e?.authenticationFailed) return `${protocol} 身份验证失败，请检查账号和授权码`;
  if (e?.code === 'ECONNREFUSED' || e?.code === 'ENOTFOUND' || e?.code === 'EDNS') return `${protocol} 无法连接，请检查服务器和端口`;
  if (e?.code === 'ETIMEDOUT' || e?.code === 'ESOCKET') return `${protocol} 连接中断或超时`;
  return `${protocol} 操作失败，请检查配置或稍后重试`;
}
