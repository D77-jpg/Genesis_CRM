import {KnowledgeAdmin} from '@/components/agent/knowledge-admin';
import {KnowledgeSalesLibrary} from '@/components/agent/knowledge-sales-library';
import {KnowledgeTraining} from '@/components/agent/knowledge-training';
import {PlaybookAdmin} from '@/components/agent/playbook-admin';
import {PageHeader} from '@/components/common/page-header';
import {useAuthStore} from '@/store/auth.store';
import {useProjectStore} from '@/store/project.store';
import {useSearchParams} from 'react-router-dom';

export function KnowledgePage(){
 const user=useAuthStore(s=>s.user),admin=user?.role==='admin';
 const project=useProjectStore(s=>s.activeProject);
 const [params,setParams]=useSearchParams();
 // Old links (documents/index) are folded into the single management view.
 const requested=params.get('view');
 const manage=admin&&(requested==='manage'||requested==='documents'||requested==='index');
 const training=admin&&requested==='training';
 const playbook=admin&&requested==='playbook';
 const active=playbook?'playbook':training?'training':manage?'manage':'sales';
 const item=params.get('knowledge')??params.get('item')??undefined;
 const key=project?.id+':'+user?.id;
 const full=manage||training||playbook;
 const tab=(id:'sales'|'manage'|'training'|'playbook')=>{
  if(id==='sales'){setParams(item?{item}:{});return;}
  setParams(id==='training'?{view:'training'}:id==='playbook'?{view:'playbook'}:{view:'manage'});
 };
 const tabs=admin?([['sales','资料库'],['manage','资料管理'],['playbook','行业卡'],['training','质量与训练']] as const):([['sales','资料库']] as const);
 const description=training?'用真实审核结果校准检索，不自动改模型权重':playbook?'行业卡只影响写作策略，不进入事实证据':manage?'把文件收成资料，发布后助手才能使用':'销售查询已发布的公司、产品与交易政策，作为写开发信的事实依据。';
 return <section className="workspace-page">
  <PageHeader title="知识库" description={description} />
  {admin&&<nav aria-label="知识库视图" className="flex flex-wrap items-center gap-1 border-b border-border">
   {tabs.map(([id,label])=><button key={id} type="button" aria-current={active===id?'page':undefined} className={'-mb-px inline-flex h-9 items-center border-b-2 px-2.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 '+(active===id?'border-foreground text-foreground':'border-transparent text-muted-foreground hover:text-foreground')} onClick={()=>tab(id)}>{label}</button>)}
   <span className="ml-auto hidden pr-1 text-[11px] text-muted-foreground sm:block">{project?.name} · 本项目资料</span>
  </nav>}
  <div className={full?'min-w-0':'min-w-0 overflow-hidden rounded-lg border border-border bg-card xl:flex xl:h-[calc(100dvh-12rem)] xl:flex-col'}>
   {playbook?<PlaybookAdmin key={key}/>:training?<KnowledgeTraining/>:manage?<KnowledgeAdmin key={key} initialKnowledgeId={requested==='manage'?item:undefined} initialDocumentId={params.get('document')??undefined} initialRevisionId={params.get('revision')??undefined} initialChunkId={params.get('chunk')??undefined}/>:<KnowledgeSalesLibrary key={key} admin={admin} initialId={item} onManage={id=>setParams(id?{view:'manage',knowledge:id}:{view:'manage'})} onImport={()=>setParams({view:'manage'})}/>}
  </div>
 </section>;
}
