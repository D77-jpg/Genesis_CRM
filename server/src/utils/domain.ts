/** Extract a bare lowercase domain from an email address, URL or domain string. */
export function domainFromAddress(value?: string): string {
  const input = String(value || '').trim().toLowerCase();
  if (!input) return '';
  const email = input.match(/@([a-z0-9.-]+\.[a-z]{2,})/i);
  if (email) return email[1];
  try {
    const url = new URL(input.includes('://') ? input : `https://${input}`);
    return url.hostname.replace(/^www\./, '');
  } catch {
    return input.replace(/^@/, '').replace(/^www\./, '');
  }
}
