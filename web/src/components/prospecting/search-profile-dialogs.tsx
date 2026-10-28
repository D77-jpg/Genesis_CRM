import * as React from 'react';
import {Copy,Plus,Trash2} from 'lucide-react';
import {Dialog,DialogBody,DialogContent,DialogDescription,DialogFooter,DialogHeader,DialogTitle} from '@/components/ui/dialog';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Label} from '@/components/ui/label';
import {Textarea} from '@/components/ui/textarea';
import {Switch} from '@/components/ui/switch';
import {Select,SelectContent,SelectItem,SelectTrigger,SelectValue} from '@/components/ui/select';
import {apiGet,apiPost,apiPut,toErrorMessage} from '@/lib/api';
import type {ProspectingConfig,SearchProfile} from '@/types';

function ProfileSelect({id,label,value,profiles,onChange,disabled=false}:{disabled?:boolean;id:string;label:string;value:string;profiles:SearchProfile[];onChange:(id:string)=>void}){
 return <div className="space-y-2"><Label htmlFor={id}>{label}</Label><Select value={value} onValueChange={onChange} disabled={disabled}><SelectTrigger id={id} aria-label={label} className="min-h-11"><SelectValue/></SelectTrigger><SelectContent>{profiles.map(profile=><SelectItem key={profile.id} value={profile.id}>{profile.name}</SelectItem>)}</SelectContent></Select></div>;
}
function profileError(profiles:SearchProfile[]){
 if(new Set(profiles.map(p=>p.name.trim().toLowerCase())).size!==profiles.length)return '方案名称不能重复';
 for(const p of profiles){
  if(!p.name.trim()||p.name.length>60)return '请填写 1–60 字的方案名称';
  if(!p.queries.length||p.queries.length>20||p.queries.some(q=>q.length<3||q.length>200))return '方案“'+p.name+'”需要 1–20 条搜索词，每条 3–200 个字';
  if(!Number.isInteger(p.enrichLimit)||p.enrichLimit<1||p.enrichLimit>80||!Number.isInteger(p.hunterLimit)||p.hunterLimit<0||p.hunterLimit>50||!Number.isInteger(p.minScore)||p.minScore<0||p.minScore>100)return '请核对方案“'+p.name+'”的数量与入选分数范围';
 }
 return '';
}
function useConfig(open:boolean){
 const [config,setConfig]=React.useState<ProspectingConfig|null>(null),[error,setError]=React.useState(''),[attempt,retry]=React.useReducer(n=>n+1,0);
 React.useEffect(()=>{if(!open)return;let active=true;setConfig(null);setError('');
 void apiGet<ProspectingConfig>('/prospecting/config').then(value=>{if(active)setConfig(value);}).catch(reason=>{if(active)setError(toErrorMessage(reason,'搜索方案读取失败'));});
 return()=>{active=false;};},[open,attempt]);
 return {config,setConfig,error,setError,retry};
}
interface Props {open:boolean;onOpenChange:(open:boolean)=>void;onCompleted:()=>void;personal?:boolean}
export function ProspectingSettingsDialog({open,onOpenChange,onCompleted}:Props){
 const {config,setConfig,error,setError,retry}=useConfig(open),[selected,setSelected]=React.useState(''),[saving,setSaving]=React.useState(false);
 const profile=config?.profiles.find(p=>p.id===selected)??config?.profiles.find(p=>p.id===config.activeProfileId)??config?.profiles[0];
 const patch=(value:Partial<SearchProfile>)=>setConfig(current=>current&&profile?{...current,profiles:current.profiles.map(p=>p.id===profile.id?{...p,...value}:p)}:current);
 const add=(copy:boolean)=>{if(!config||!profile)return;const id=crypto.randomUUID();let n=config.profiles.length+1;let name=(copy?profile.name.slice(0,40)+' 副本 ':'新方案 ')+n;while(config.profiles.some(p=>p.name===name))name=(copy?profile.name.slice(0,40)+' 副本 ':'新方案 ')+(++n);
 setConfig({...config,profiles:[...config.profiles,{...profile,id,name,queries:copy?[...profile.queries]:['']}]});setSelected(id);setError('');};
 const remove=()=>{if(!config||!profile||config.profiles.length===1)return;const profiles=config.profiles.filter(p=>p.id!==profile.id);setConfig({...config,profiles,activeProfileId:config.activeProfileId===profile.id?profiles[0].id:config.activeProfileId});setSelected(profiles[0].id);};
 async function save(){if(!config)return;const clean=config.profiles.map(p=>({...p,name:p.name.trim(),queries:p.queries.map(q=>q.trim()).filter(Boolean)}));const invalid=profileError(clean);if(invalid){setError(invalid);return;}setSaving(true);setError('');
 try{await apiPut('/prospecting/config',{version:config.version,enabled:config.enabled,profiles:clean,activeProfileId:config.activeProfileId});onCompleted();onOpenChange(false);}
 catch(reason){setError(toErrorMessage(reason,'方案保存失败'));}finally{setSaving(false);}}
 return <Dialog open={open} onOpenChange={next=>!saving&&onOpenChange(next)}><DialogContent className="max-w-2xl"><DialogHeader><DialogTitle>搜索设置</DialogTitle><DialogDescription>按品类或市场保存多套方案。自动生成使用默认方案，手动生成可以临时选择其它方案。</DialogDescription></DialogHeader>
 <DialogBody className="space-y-5">
 {error&&<div role="alert" className="space-y-2 rounded-md border border-destructive/30 p-3 text-sm text-destructive"><p>{error}</p><Button type="button" variant="outline" className="min-h-11" onClick={retry} disabled={saving}>重新读取已保存设置</Button></div>}
 {!config&&!error&&<p role="status">正在读取搜索方案…</p>}
 {config&&profile&&<>
  <div className="flex items-start justify-between gap-3 rounded-lg border p-4"><div><p className="font-medium">每天自动生成</p><p className="mt-1 text-sm leading-6 text-muted-foreground">每天 {config.runAt}（{config.timezone}）按默认方案运行，重启后 3 小时内补跑。</p></div><Switch aria-label="每天自动生成" checked={config.enabled} disabled={saving} onCheckedChange={enabled=>setConfig({...config,enabled})}/></div>
  <ProfileSelect id="automatic-search-profile" label="自动生成默认方案" value={config.activeProfileId} profiles={config.profiles} disabled={saving} onChange={activeProfileId=>setConfig({...config,activeProfileId})}/>
  <div className="space-y-4 rounded-lg border p-4">
   <ProfileSelect id="editing-search-profile" label="编辑搜索方案" value={profile.id} profiles={config.profiles} disabled={saving} onChange={setSelected}/>
   <div className="flex flex-wrap gap-2"><Button type="button" variant="outline" className="min-h-11" disabled={saving||config.profiles.length>=20} onClick={()=>add(false)}><Plus className="h-4 w-4" aria-hidden/>新增方案</Button><Button type="button" variant="outline" className="min-h-11" disabled={saving||config.profiles.length>=20} onClick={()=>add(true)}><Copy className="h-4 w-4" aria-hidden/>复制方案</Button><Button type="button" variant="ghost" className="min-h-11 text-destructive" disabled={saving||config.profiles.length<=1} onClick={remove}><Trash2 className="h-4 w-4" aria-hidden/>移除当前方案</Button></div>
   <div className="space-y-2"><Label htmlFor="search-profile-name">方案名称</Label><Input id="search-profile-name" maxLength={60} value={profile.name} disabled={saving} onChange={e=>patch({name:e.target.value})} placeholder="例如：美国珠宝品牌"/></div>
   <div className="space-y-2"><Label htmlFor="config-queries">搜索词（每行一条，最多 20 条）</Label><Textarea id="config-queries" className="min-h-36" value={profile.queries.join('\n')} disabled={saving} onChange={e=>patch({queries:e.target.value.split('\n')})}/><p className="text-sm leading-6 text-muted-foreground">建议每个品类 2–3 条，带国家或风格限定；可使用 -site: 排除平台站。</p></div>
   <div className="grid gap-3 sm:grid-cols-3"><div className="space-y-2"><Label htmlFor="config-enrich">每次补全数量</Label><Input id="config-enrich" type="number" min={1} max={80} value={Number.isNaN(profile.enrichLimit)?'':profile.enrichLimit} disabled={saving} onChange={e=>patch({enrichLimit:e.target.valueAsNumber})}/></div><div className="space-y-2"><Label htmlFor="config-hunter">Hunter 查询上限</Label><Input id="config-hunter" type="number" min={0} max={50} value={Number.isNaN(profile.hunterLimit)?'':profile.hunterLimit} disabled={saving} onChange={e=>patch({hunterLimit:e.target.valueAsNumber})}/></div><div className="space-y-2"><Label htmlFor="config-min">入选分数</Label><Input id="config-min" type="number" min={0} max={100} value={Number.isNaN(profile.minScore)?'':profile.minScore} disabled={saving} onChange={e=>patch({minScore:e.target.valueAsNumber})}/></div></div>
   <div className="flex items-start justify-between gap-3 rounded-md bg-muted/40 p-3"><div><p className="text-sm font-medium">客户画像评分</p><p className="mt-1 text-sm leading-6 text-muted-foreground">{config.profileTitle?'依据资料库《'+config.profileTitle+'》':'资料库未找到客户画像，使用内置规则。'}</p></div><Switch aria-label="AI 画像评分" checked={profile.llmScoring} disabled={saving} onCheckedChange={llmScoring=>patch({llmScoring})}/></div>
  </div><p className="text-sm text-muted-foreground">新增、改名和移除会在保存后生效；正在运行的任务继续使用启动时的方案。</p>
 </>}
 </DialogBody><DialogFooter><Button type="button" variant="outline" className="min-h-11" disabled={saving} onClick={()=>onOpenChange(false)}>取消</Button><Button type="button" className="min-h-11" disabled={!config} loading={saving} onClick={()=>void save()}>保存全部方案</Button></DialogFooter></DialogContent></Dialog>;
}

export function ProspectingRunDialog({open,onOpenChange,onCompleted,personal=false}:Props){
 const {config,error,setError,retry}=useConfig(open),[choice,setChoice]=React.useState<{id:string;queries:string;enrichLimit:number}|null>(null),[saving,setSaving]=React.useState(false);
 React.useEffect(()=>{if(config){const p=config.profiles.find(p=>p.id===config.activeProfileId)??config.profiles[0];setChoice({id:p.id,queries:p.queries.join('\n'),enrichLimit:p.enrichLimit});}else setChoice(null);},[config]);
 const profile=config?.profiles.find(p=>p.id===choice?.id);
 async function start(){if(!choice||!profile)return;const queries=choice.queries.split('\n').map(q=>q.trim()).filter(Boolean);const invalid=profileError([{...profile,queries,enrichLimit:choice.enrichLimit}]);if(invalid){setError(invalid);return;}setSaving(true);setError('');
 try{await apiPost('/prospecting/run',{profileId:choice.id,queries,enrichLimit:choice.enrichLimit});onCompleted();onOpenChange(false);}catch(reason){setError(toErrorMessage(reason,'启动失败'));}finally{setSaving(false);}}
 return <Dialog open={open} onOpenChange={next=>!saving&&onOpenChange(next)}><DialogContent className="max-w-lg"><DialogHeader><DialogTitle>生成今日候选</DialogTitle><DialogDescription>选择已保存的方案；本次临时修改不会覆盖自动生成的默认设置。{personal?'生成结果会直接进入你的「我的今日开发」，每天限一轮。':''}</DialogDescription></DialogHeader><DialogBody className="space-y-4">
 {error&&<div role="alert" className="space-y-2 text-sm text-destructive"><p>{error}</p>{!config&&<Button type="button" variant="outline" onClick={retry}>重新读取方案</Button>}</div>}
 {!config&&!error&&<p role="status">正在读取搜索方案…</p>}
 {config&&choice&&profile&&<><ProfileSelect id="run-search-profile" label="本次搜索方案" value={choice.id} profiles={config.profiles} disabled={saving} onChange={id=>{const p=config.profiles.find(p=>p.id===id)!;setChoice({id,queries:p.queries.join('\n'),enrichLimit:p.enrichLimit});setError('');}}/>
 <div className="space-y-2"><Label htmlFor="prospect-queries">本次搜索词（每行一条）</Label><Textarea id="prospect-queries" className="min-h-36" value={choice.queries} disabled={saving} onChange={e=>setChoice({...choice,queries:e.target.value})}/></div>
 <div className="space-y-2"><Label htmlFor="prospect-enrich">本次补全数量</Label><Input id="prospect-enrich" type="number" min={1} max={80} value={Number.isNaN(choice.enrichLimit)?'':choice.enrichLimit} disabled={saving} onChange={e=>setChoice({...choice,enrichLimit:e.target.valueAsNumber})}/></div>
 <p className="text-sm leading-6 text-muted-foreground">Hunter 最多 {profile.hunterLimit} 次；入选分数 {profile.minScore}；画像评分{profile.llmScoring?'开启':'关闭'}。每个候选最多看 3 个官网页面，按实际查询次数扣额度。</p></>}
 </DialogBody><DialogFooter><Button type="button" variant="outline" className="min-h-11" disabled={saving} onClick={()=>onOpenChange(false)}>取消</Button><Button type="button" className="min-h-11" disabled={!choice||!config} loading={saving} onClick={()=>void start()}>开始生成</Button></DialogFooter></DialogContent></Dialog>;
}
