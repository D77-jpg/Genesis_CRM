import * as React from 'react';
import { CheckCircle2, Inbox, KeyRound, Mail, ShieldCheck, TriangleAlert } from 'lucide-react';
import { toast } from 'sonner';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { apiGet, apiPost, apiPut, toErrorMessage } from '@/lib/api';
import type { MailAccountInput, MailAccountVerificationResult, UserDto, UserMailAccount } from '@/types';

const EMPTY_FORM: MailAccountInput = {
  email: '', displayName: '', smtpHost: '', smtpPort: 465, smtpSecure: true,
  smtpRequireTls: true, smtpUsername: '', imapEnabled: false, imapHost: '', imapPort: 993,
  imapSecure: true, imapUsername: '', password: '', status: 'active', dailyLimit: 100,
};

function toForm(account: UserMailAccount | null, user: UserDto): MailAccountInput {
  if (!account) return { ...EMPTY_FORM, displayName: user.displayName || user.username };
  return {
    email: account.email, displayName: account.displayName, smtpHost: account.smtpHost,
    smtpPort: account.smtpPort, smtpSecure: account.smtpSecure, smtpRequireTls: account.smtpRequireTls,
    smtpUsername: account.smtpUsername, imapEnabled: account.imapEnabled, imapHost: account.imapHost || '',
    imapPort: account.imapPort, imapSecure: account.imapSecure, imapUsername: account.imapUsername || '',
    password: '', status: account.status, dailyLimit: account.dailyLimit,
  };
}

export function MailAccountDialog({ open, onOpenChange, user }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  user: UserDto | null;
}): React.JSX.Element {
  const [account, setAccount] = React.useState<UserMailAccount | null>(null);
  const [form, setForm] = React.useState<MailAccountInput>(EMPTY_FORM);
  const [loading, setLoading] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open || !user) return;
    let active = true;
    setLoading(true);
    setError(null);
    void apiGet<UserMailAccount | null>(`/mail-accounts/users/${user.id}`)
      .then((result) => {
        if (!active) return;
        setAccount(result);
        setForm(toForm(result, user));
      })
      .catch((reason) => { if (active) setError(toErrorMessage(reason, '邮箱配置加载失败')); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [open, user]);

  const setField = <K extends keyof MailAccountInput>(key: K, value: MailAccountInput[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const save = React.useCallback(async (verifyAfter: boolean) => {
    if (!user || saving) return;
    if (!form.email.trim() || !form.smtpHost.trim() || !form.smtpUsername.trim()) {
      setError('请填写发件邮箱、SMTP 服务器和 SMTP 用户名');
      return;
    }
    if (form.imapEnabled && (!form.imapHost?.trim() || !form.imapUsername?.trim())) {
      setError('启用收件同步后，请填写 IMAP 服务器和用户名');
      return;
    }
    if (!account && !form.password) {
      setError('首次配置必须填写邮箱授权码');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const payload = { ...form, password: form.password || undefined };
      let saved = await apiPut<UserMailAccount>(`/mail-accounts/users/${user.id}`, payload);
      setAccount(saved);
      setForm(toForm(saved, user));
      if (verifyAfter) {
        const result = await apiPost<MailAccountVerificationResult>(`/mail-accounts/users/${user.id}/verify`);
        saved = result.account;
        setAccount(saved);
        setForm(toForm(saved, user));
        if (!result.success) {
          setError(result.message);
          toast.error('邮箱验证失败', { description: result.message });
          return;
        }
        toast.success('邮箱验证通过', { description: saved.email });
      } else {
        toast.success('邮箱配置已保存', { description: '连接信息变化后需要重新验证才能真实发送' });
      }
    } catch (reason) {
      setError(toErrorMessage(reason, '邮箱配置保存失败'));
    } finally {
      setSaving(false);
    }
  }, [account, form, saving, user]);

  const verificationBadge = account?.verificationStatus === 'verified'
    ? <Badge variant="developed"><CheckCircle2 className="mr-1 h-3 w-3" aria-hidden />已验证</Badge>
    : account?.verificationStatus === 'failed'
      ? <Badge variant="destructive"><TriangleAlert className="mr-1 h-3 w-3" aria-hidden />验证失败</Badge>
      : <Badge variant="muted">未验证</Badge>;

  const imapBadge = !form.imapEnabled
    ? <Badge variant="outline">未启用收件</Badge>
    : account?.imapVerificationStatus === 'verified'
      ? <Badge variant="developed"><CheckCircle2 className="mr-1 h-3 w-3" aria-hidden />IMAP 已验证</Badge>
      : account?.imapVerificationStatus === 'failed'
        ? <Badge variant="destructive"><TriangleAlert className="mr-1 h-3 w-3" aria-hidden />IMAP 失败</Badge>
        : <Badge variant="muted">IMAP 未验证</Badge>;

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!saving) onOpenChange(next); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Mail className="h-4 w-4 text-primary" aria-hidden />配置个人邮箱
          </DialogTitle>
          <DialogDescription>
            {user ? `为 ${user.displayName || user.username} 配置当前项目的独立发件与收件账号。` : ''}
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="space-y-4">
          {loading ? <p className="py-8 text-center text-sm text-muted-foreground">正在读取邮箱配置…</p> : null}
          {!loading ? (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-muted/25 px-3 py-2.5">
                <div>
                  <p className="text-sm font-medium">{account?.email || '尚未配置邮箱'}</p>
                  <p className="text-xs text-muted-foreground">
                    {account ? `今日已尝试 ${account.usedToday} / ${account.dailyLimit} 封` : '保存并验证后才能用于真实发送'}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {verificationBadge}
                  {imapBadge}
                  {account?.status === 'disabled' ? <Badge variant="outline">已停用</Badge> : null}
                </div>
              </div>

              {error ? (
                <Alert variant="destructive">
                  <TriangleAlert aria-hidden />
                  <AlertTitle>邮箱配置未就绪</AlertTitle>
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              ) : null}

              <div className="grid gap-3 sm:grid-cols-2">
                <div><Label htmlFor="mail-account-email">发件邮箱</Label><Input id="mail-account-email" type="email" className="mt-1.5" value={form.email} onChange={(e) => setField('email', e.target.value)} placeholder="susan@company.com" disabled={saving} /></div>
                <div><Label htmlFor="mail-account-name">发件人名称</Label><Input id="mail-account-name" className="mt-1.5" value={form.displayName} onChange={(e) => setField('displayName', e.target.value)} placeholder="Susan Yao" disabled={saving} /></div>
                <div><Label htmlFor="mail-account-host">SMTP 服务器</Label><Input id="mail-account-host" className="mt-1.5" value={form.smtpHost} onChange={(e) => setField('smtpHost', e.target.value)} placeholder="smtp.example.com" disabled={saving} /></div>
                <div><Label htmlFor="mail-account-port">SMTP 端口</Label><Input id="mail-account-port" type="number" min={1} max={65535} className="mt-1.5" value={form.smtpPort} onChange={(e) => setField('smtpPort', Number(e.target.value))} disabled={saving} /></div>
                <div><Label htmlFor="mail-account-username">SMTP 用户名</Label><Input id="mail-account-username" className="mt-1.5" value={form.smtpUsername} onChange={(e) => setField('smtpUsername', e.target.value)} placeholder="通常与发件邮箱相同" disabled={saving} /></div>
                <div>
                  <Label htmlFor="mail-account-password">邮箱授权码</Label>
                  <Input id="mail-account-password" type="password" autoComplete="new-password" className="mt-1.5" value={form.password ?? ''} onChange={(e) => setField('password', e.target.value)} placeholder={account?.credentialSet ? '留空则保留原授权码' : '首次配置必须填写'} disabled={saving} />
                  <p className="mt-1 text-2xs text-muted-foreground">仅加密保存在服务端，页面不会回显。</p>
                </div>
                <div><Label htmlFor="mail-account-limit">每日发送额度</Label><Input id="mail-account-limit" type="number" min={1} max={5000} className="mt-1.5" value={form.dailyLimit} onChange={(e) => setField('dailyLimit', Number(e.target.value))} disabled={saving} /></div>
              </div>

              <div className="grid gap-3 rounded-md border p-3 sm:grid-cols-3">
                <label className="flex items-start gap-2.5"><Switch checked={form.smtpSecure} onCheckedChange={(v) => setField('smtpSecure', v)} disabled={saving} /><span><span className="block text-sm font-medium">SSL/TLS</span><span className="block text-xs text-muted-foreground">通常用于 465 端口</span></span></label>
                <label className="flex items-start gap-2.5"><Switch checked={form.smtpRequireTls} onCheckedChange={(v) => setField('smtpRequireTls', v)} disabled={saving} /><span><span className="block text-sm font-medium">强制 TLS</span><span className="block text-xs text-muted-foreground">推荐保持开启</span></span></label>
                <label className="flex items-start gap-2.5"><Switch checked={form.status === 'active'} onCheckedChange={(v) => setField('status', v ? 'active' : 'disabled')} disabled={saving} /><span><span className="block text-sm font-medium">允许发送</span><span className="block text-xs text-muted-foreground">关闭后立即阻止新任务</span></span></label>
              </div>

              <details className="rounded-md border" open={form.imapEnabled}>
                <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <span className="flex min-w-0 items-center gap-2"><Inbox className="h-4 w-4 shrink-0 text-primary" aria-hidden /><span><span className="block text-sm font-medium">个人收件同步</span><span className="block text-xs text-muted-foreground">可选：把客户回信同步到该业务员的邮件中心</span></span></span>
                  {imapBadge}
                </summary>
                <div className="space-y-3 border-t p-3">
                  <label className="flex items-start gap-2.5"><Switch checked={form.imapEnabled} onCheckedChange={(v) => setField('imapEnabled', v)} disabled={saving} /><span><span className="block text-sm font-medium">启用 IMAP 收件</span><span className="block text-xs text-muted-foreground">只读拉取 INBOX，不会删除或移动原邮箱邮件</span></span></label>
                  {form.imapEnabled ? <div className="grid gap-3 sm:grid-cols-2">
                    <div><Label htmlFor="mail-account-imap-host">IMAP 服务器</Label><Input id="mail-account-imap-host" className="mt-1.5" value={form.imapHost || ''} onChange={(e) => setField('imapHost', e.target.value)} placeholder="imap.example.com" disabled={saving} /></div>
                    <div><Label htmlFor="mail-account-imap-port">IMAP 端口</Label><Input id="mail-account-imap-port" type="number" min={1} max={65535} className="mt-1.5" value={form.imapPort} onChange={(e) => setField('imapPort', Number(e.target.value))} disabled={saving} /></div>
                    <div><Label htmlFor="mail-account-imap-user">IMAP 用户名</Label><Input id="mail-account-imap-user" className="mt-1.5" value={form.imapUsername || ''} onChange={(e) => setField('imapUsername', e.target.value)} placeholder="通常与发件邮箱相同" disabled={saving} /></div>
                    <label className="flex items-center gap-2.5 self-end rounded-md border px-3 py-2.5"><Switch checked={form.imapSecure} onCheckedChange={(v) => setField('imapSecure', v)} disabled={saving} /><span><span className="block text-sm font-medium">IMAP SSL/TLS</span><span className="block text-xs text-muted-foreground">通常用于 993 端口</span></span></label>
                  </div> : null}
                  <p className="text-xs text-muted-foreground">IMAP 与 SMTP 共用上方的邮箱授权码；修改任何连接信息后需重新验证。</p>
                </div>
              </details>

              <p className="flex items-start gap-1.5 text-xs text-muted-foreground"><ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />发件地址与收件账号由服务端锁定，业务员不能冒用其他人的邮箱。</p>
            </>
          ) : null}
        </DialogBody>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>取消</Button>
          <Button type="button" variant="outline" onClick={() => void save(false)} loading={saving} disabled={loading || saving}><KeyRound className="h-3.5 w-3.5" aria-hidden />仅保存</Button>
          <Button type="button" onClick={() => void save(true)} loading={saving} disabled={loading || saving}><CheckCircle2 className="h-3.5 w-3.5" aria-hidden />保存并验证</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
