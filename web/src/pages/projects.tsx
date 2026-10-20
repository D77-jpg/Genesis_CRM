import * as React from 'react';
import { Archive, ArrowRight, Building2, CircleHelp, Pencil, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/common/page-header';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { usePageTitle } from '@/hooks/use-ui';
import { useProjectStore } from '@/store/project.store';
import type { Project } from '@/types';

const slugify = (value: string) => value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
type ProjectForm = Record<'name' | 'code' | 'slug' | 'industry' | 'companyName' | 'website' | 'moq' | 'senderName' | 'mailFrom' | 'mailProfileKey', string> & { coverImage: string };
const EMPTY_FORM: ProjectForm = { name: '', code: '', slug: '', industry: '', companyName: '', website: '', moq: '', senderName: '', mailFrom: '', mailProfileKey: '', coverImage: '' };

export function ProjectsPage(): React.JSX.Element {
  usePageTitle('项目工作空间');
  const items = useProjectStore((state) => state.items);
  const activeProject = useProjectStore((state) => state.activeProject);
  const createProject = useProjectStore((state) => state.createProject);
  const updateProject = useProjectStore((state) => state.updateProject);
  const deleteProject = useProjectStore((state) => state.deleteProject);
  const switchProject = useProjectStore((state) => state.switchProject);
  const [open, setOpen] = React.useState(false);
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [form, setForm] = React.useState<ProjectForm>(EMPTY_FORM);
  const [deleteTarget, setDeleteTarget] = React.useState<Project | null>(null);
  const [deleteConfirm, setDeleteConfirm] = React.useState('');
  const [deleting, setDeleting] = React.useState(false);

  const openCreate = () => { setEditingId(null); setForm(EMPTY_FORM); setOpen(true); };
  const openEdit = (project: Project) => {
    setEditingId(project.id);
    setForm({ name: project.name, code: project.code, slug: project.slug, industry: project.industry ?? '',
      companyName: project.companyName, website: project.website ?? '', moq: project.moq ?? '',
      senderName: project.senderName ?? '', mailFrom: project.mailFrom ?? '', mailProfileKey: project.mailProfileKey, coverImage: project.coverImage ?? '' });
    setOpen(true);
  };

  const applyCover = async (file?: File) => {
    if (!file) return;
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) { toast.error('请选择 PNG / JPG / WebP 图片'); return; }
    if (file.size > 8 * 1024 ** 2) { toast.error('图片请小于 8MB'); return; }
    try {
      const bitmap = await createImageBitmap(file);
      const scale = Math.min(1, 1280 / bitmap.width);
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(bitmap.width * scale);
      canvas.height = Math.round(bitmap.height * scale);
      canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      setForm((value) => ({ ...value, coverImage: canvas.toDataURL('image/jpeg', 0.82) }));
    } catch {
      toast.error('图片读取失败，请换一张试试');
    }
  };

  const submit = async () => {
    const slug = slugify(form.slug || form.name);
    if (!form.name.trim() || !form.companyName.trim() || (!editingId && (!form.code.trim() || !slug))) return;
    setSaving(true);
    try {
      if (editingId) {
        await updateProject(editingId, { name: form.name.trim(), industry: form.industry.trim(), companyName: form.companyName.trim(),
          website: form.website.trim(), moq: form.moq.trim(), senderName: form.senderName.trim(), mailFrom: form.mailFrom.trim(),
          mailProfileKey: slugify(form.mailProfileKey || form.slug), coverImage: form.coverImage });
        toast.success('项目资料已更新');
      } else {
        await createProject({ name: form.name.trim(), code: form.code.trim().toUpperCase(), slug,
          industry: form.industry.trim(), companyName: form.companyName.trim(), website: form.website.trim(), moq: form.moq.trim(),
          senderName: form.senderName.trim(), mailFrom: form.mailFrom.trim(), mailProfileKey: slugify(form.mailProfileKey || slug), coverImage: form.coverImage });
        toast.success('项目工作空间已创建', { description: `${form.name} 已与其他项目严格隔离` });
      }
      setForm(EMPTY_FORM);
      setEditingId(null);
      setOpen(false);
    } catch (error) {
      toast.error('创建失败', { description: error instanceof Error ? error.message : '请稍后重试' });
    } finally { setSaving(false); }
  };

  const toggleArchive = async (id: string, archived: boolean) => {
    try {
      await updateProject(id, { status: archived ? 'active' : 'archived' });
      toast.success(archived ? '项目已恢复' : '项目已归档');
    } catch (error) {
      toast.error('操作失败', { description: error instanceof Error ? error.message : '请稍后重试' });
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget || deleteConfirm !== deleteTarget.name) return;
    setDeleting(true);
    try {
      await deleteProject(deleteTarget.id);
      toast.success('项目已删除', { description: `${deleteTarget.name} 及其数据已永久移除` });
      setDeleteTarget(null);
      setDeleteConfirm('');
    } catch (error) {
      toast.error('删除失败', { description: error instanceof Error ? error.message : '请稍后重试' });
    } finally { setDeleting(false); }
  };

  return (
    <div className="workspace-page">
      <PageHeader title="项目工作空间" description="每个项目拥有独立的客户、邮件、模板、报价、Timeline 与统计数据。"
        actions={<Button type="button" onClick={openCreate}><Plus className="h-4 w-4" aria-hidden />新建项目</Button>} />

      <div role="note" className="flex gap-3 rounded-lg border bg-muted/30 px-4 py-3 text-sm">
        <CircleHelp className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
        <div>
          <p className="font-medium">多个项目可以同时处于“可用”状态，不会合并或污染数据。</p>
          <p className="mt-1 text-muted-foreground">顶部项目切换器决定当前正在使用的工作空间；客户、邮件和统计每次只读取一个当前项目。要归档当前项目，请先切换到另一个项目。</p>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {items.map((project) => {
          const isCurrent = project.id === activeProject?.id;
          return (
          <Card key={project.id} className={'overflow-hidden ' + (project.status === 'archived' ? 'opacity-70' : isCurrent ? 'border-primary/50 ring-1 ring-primary/20' : '')}>
            {project.coverImage ? (
              <div className="aspect-[16/9] w-full bg-muted">
                <img src={project.coverImage} alt={`${project.name} 封面`} className="h-full w-full object-cover" loading="lazy" />
              </div>
            ) : null}
            <CardHeader className="flex-row items-start justify-between gap-3 space-y-0">
              <div className="flex min-w-0 items-center gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-sm font-semibold text-primary" aria-hidden>{project.code.slice(0, 2)}</span>
                <div className="min-w-0"><CardTitle className="truncate text-base" title={project.name}>{project.name}</CardTitle><p className="truncate text-xs text-muted-foreground">{project.code} · {project.industry || '未设置行业'}</p></div>
              </div>
              <Badge variant={project.status === 'archived' ? 'muted' : isCurrent ? 'developed' : 'outline'}>
                {project.status === 'archived' ? '已归档' : isCurrent ? '当前使用' : '可切换'}
              </Badge>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div><p className="text-xs text-muted-foreground">公司主体</p><p className="truncate" title={project.companyName}>{project.companyName}</p></div>
              <div className="flex flex-wrap gap-2"><Badge variant="outline">{project.mailChannel === 'smtp' ? '邮箱发送' : '模拟发送'}</Badge>{project.isDefault ? <Badge variant="outline">默认项目</Badge> : null}</div>
              <div className="flex flex-wrap gap-2">
                {project.status === 'active' && !isCurrent ? (
                  <Button type="button" size="sm" onClick={() => switchProject(project.id)}>
                    <ArrowRight className="h-4 w-4" aria-hidden />切换到此项目
                  </Button>
                ) : null}
                <Button type="button" variant="outline" size="sm" onClick={() => openEdit(project)}><Pencil className="h-4 w-4" aria-hidden />编辑资料</Button>
                <Button type="button" variant="outline" size="sm"
                  disabled={project.isDefault || (isCurrent && project.status === 'active')}
                  aria-describedby={`project-archive-help-${project.id}`}
                  onClick={() => void toggleArchive(project.id, project.status === 'archived')}>
                  {project.status === 'archived' ? <RotateCcw className="h-4 w-4" aria-hidden /> : <Archive className="h-4 w-4" aria-hidden />}
                  {project.status === 'archived' ? '恢复项目' : '归档项目'}
                </Button>
                {!project.isDefault ? <Button type="button" variant="ghost" size="sm" className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                  onClick={() => { setDeleteTarget(project); setDeleteConfirm(''); }}>
                  <Trash2 className="h-4 w-4" aria-hidden />删除项目
                </Button> : null}
              </div>
              {project.isDefault || (isCurrent && project.status === 'active') ? (
                <p id={`project-archive-help-${project.id}`} className="text-xs text-muted-foreground">
                  {project.isDefault ? '默认项目为历史数据归属，不能归档。' : '当前正在使用；切换到其他项目后即可归档。'}
                </p>
              ) : null}
            </CardContent>
          </Card>
          );
        })}
      </div>

      <Dialog open={open} onOpenChange={(next) => !saving && setOpen(next)}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><Building2 className="h-4 w-4 text-primary" aria-hidden />{editingId ? '编辑项目资料' : '新建项目工作空间'}</DialogTitle><DialogDescription>公司资料用于邮件署名和项目展示。邮箱账号请由管理员单独配置。</DialogDescription></DialogHeader>
          <DialogBody className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2"><Label htmlFor="project-name">项目名称</Label><Input id="project-name" className="mt-1.5" value={form.name} onChange={(e) => { const name = e.target.value; setForm((v) => ({ ...v, name, companyName: v.companyName === v.name ? name : v.companyName })); }} placeholder="例如 Outdoor Gear" /></div>
            <div><Label htmlFor="project-code">项目代码</Label><Input id="project-code" className="mt-1.5" value={form.code} disabled={Boolean(editingId)} onChange={(e) => setForm((v) => ({ ...v, code: e.target.value }))} placeholder="OUTDOOR" /></div>
            <div><Label htmlFor="project-industry">行业</Label><Input id="project-industry" className="mt-1.5" value={form.industry} onChange={(e) => setForm((v) => ({ ...v, industry: e.target.value }))} placeholder="户外用品外贸" /></div>
            <div className="sm:col-span-2"><Label htmlFor="project-company">公司主体</Label><Input id="project-company" className="mt-1.5" value={form.companyName} onChange={(e) => setForm((v) => ({ ...v, companyName: e.target.value }))} placeholder="用于邮件签名和占位符" /></div>
            <div><Label htmlFor="project-website">公司网站</Label><Input id="project-website" className="mt-1.5" value={form.website} onChange={(e) => setForm((v) => ({ ...v, website: e.target.value }))} placeholder="https://example.com" /></div>
            <div><Label htmlFor="project-moq">默认 MOQ</Label><Input id="project-moq" className="mt-1.5" value={form.moq} onChange={(e) => setForm((v) => ({ ...v, moq: e.target.value }))} placeholder="100 pcs" /></div>
            <div><Label htmlFor="project-sender">发件人名称</Label><Input id="project-sender" className="mt-1.5" value={form.senderName} onChange={(e) => setForm((v) => ({ ...v, senderName: e.target.value }))} placeholder="Sales Team" /></div>
            <div><Label htmlFor="project-mail-from">发件地址显示</Label><Input id="project-mail-from" className="mt-1.5" value={form.mailFrom} onChange={(e) => setForm((v) => ({ ...v, mailFrom: e.target.value }))} placeholder="Sales <sales@example.com>" /></div>
            <div><Label htmlFor="project-slug">项目标识</Label><Input id="project-slug" className="mt-1.5" value={form.slug} disabled={Boolean(editingId)} onChange={(e) => setForm((v) => ({ ...v, slug: slugify(e.target.value) }))} placeholder={slugify(form.name) || 'outdoor-gear'} /></div>
            <div><Label htmlFor="project-profile">邮箱配置标识</Label><Input id="project-profile" className="mt-1.5" value={form.mailProfileKey} onChange={(e) => setForm((v) => ({ ...v, mailProfileKey: slugify(e.target.value) }))} placeholder={slugify(form.slug || form.name) || 'outdoor-gear'} /></div>
            <div className="sm:col-span-2 space-y-2">
              <Label htmlFor="project-cover">封面图（可选）</Label>
              <div className="flex flex-wrap items-center gap-3">
                <div className="h-16 w-28 shrink-0 overflow-hidden rounded-md border bg-muted">
                  {form.coverImage ? <img src={form.coverImage} alt="封面预览" className="h-full w-full object-cover" /> : null}
                </div>
                <Input id="project-cover" type="file" accept="image/png,image/jpeg,image/webp" className="max-w-[16rem]" onChange={(event) => { void applyCover(event.target.files?.[0]); event.target.value = ''; }} />
                {form.coverImage ? <Button type="button" variant="ghost" size="sm" onClick={() => setForm((value) => ({ ...value, coverImage: '' }))}>移除封面</Button> : null}
              </div>
              <p className="text-xs text-muted-foreground">建议 16:9 横图；浏览器压缩到 1280px 宽后随项目保存，不上传到第三方。</p>
            </div>
            <p className="sm:col-span-2 -mt-2 text-xs text-muted-foreground">项目标识创建后不可修改。邮箱配置标识用于关联项目邮箱，修改前请与管理员确认。</p>
          </DialogBody>
          <DialogFooter><Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={saving}>取消</Button><Button type="button" loading={saving} disabled={!form.name.trim() || !form.companyName.trim() || (!editingId && !form.code.trim())} onClick={() => void submit()}>{editingId ? '保存修改' : '创建项目'}</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(deleteTarget)} onOpenChange={(next) => { if (!deleting && !next) setDeleteTarget(null); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Trash2 className="h-4 w-4 text-destructive" aria-hidden />删除项目「{deleteTarget?.name}」？</DialogTitle>
            <DialogDescription>该项目下的客户、邮件、开发信、模板、报价、知识库、助手任务与统计数据会被永久删除，无法恢复。默认项目不能删除。</DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-2">
            <Label htmlFor="delete-project-confirm">输入项目名称 <span className="font-semibold text-foreground">{deleteTarget?.name}</span> 以确认</Label>
            <Input id="delete-project-confirm" value={deleteConfirm} onChange={(event) => setDeleteConfirm(event.target.value)} autoComplete="off" placeholder={deleteTarget?.name} />
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={deleting} onClick={() => setDeleteTarget(null)}>取消</Button>
            <Button type="button" variant="destructive" loading={deleting} disabled={!deleteTarget || deleteConfirm !== deleteTarget.name} onClick={() => void confirmDelete()}>永久删除</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
