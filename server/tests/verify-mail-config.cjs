// Explicitly opt-in, read-only connectivity check. Does not send, fetch, or import mail.
const fs = require('node:fs');
const dotenv = require('dotenv');
const nodemailer = require('nodemailer');
const { ImapFlow } = require('imapflow');
const source = process.argv[2];
if (!source) throw new Error('Provide the local configuration path');
const e = dotenv.parse(fs.readFileSync(source));
const smtp = nodemailer.createTransport({ host: e.SMTP_HOST, port: Number(e.SMTP_PORT || 587), secure: e.SMTP_SECURE === 'true', requireTLS: true,
  auth: { user: e.SMTP_USER, pass: e.SMTP_PASS }, connectionTimeout: 15000, greetingTimeout: 15000, socketTimeout: 15000 });
const imapSecure = e.IMAP_SECURE === 'true';
const imap = new ImapFlow({ host: e.IMAP_HOST || 'imap.alibaba.com', port: Number(e.IMAP_PORT || 143), secure: imapSecure, doSTARTTLS: imapSecure ? undefined : true,
  auth: { user: e.IMAP_USER || e.SMTP_USER, pass: e.IMAP_PASSWORD || e.SMTP_PASS }, logger: false, connectionTimeout: 15000, greetingTimeout: 15000, socketTimeout: 15000 });
imap.on('error', () => {});
const result = {};
const safeError = err => ({ code: typeof err?.code === 'string' && /^[A-Z_]+$/.test(err.code) ? err.code : 'CONNECTION_FAILED', authenticationFailed: !!err?.authenticationFailed });
(async () => {
  await Promise.all([
    (async () => { try { await smtp.verify(); result.smtp = { authenticated: true, tls: 'required' }; } catch (err) { result.smtp = { authenticated: false, ...safeError(err) }; } finally { smtp.close(); } })(),
    (async () => { try { await imap.connect(); const lock = await imap.getMailboxLock(e.IMAP_MAILBOX || 'INBOX', { readOnly: true }); lock.release(); result.imap = { authenticated: true, mailboxOpenedReadOnly: true, tls: 'required' }; } catch (err) { result.imap = { authenticated: false, ...safeError(err) }; } finally { imap.close(); } })(),
  ]);
  console.log(JSON.stringify(result));
})().catch(() => { console.log('Configuration check failed (details redacted)'); process.exitCode = 1; });
