import {KnowledgeAdmin} from '@/components/agent/knowledge-admin';
import {KnowledgeSalesLibrary} from '@/components/agent/knowledge-sales-library';
import {KnowledgeTraining} from '@/components/agent/knowledge-training';
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
 const active=training?'training':manage?'manage':'sales';
 const item=params.get('knowledge')??params.get('item')??undefined;
 const key=project?.id+':'+user?.id;
 const full=manage||training;
 const tab=(id:'sales'|'manage'|'training')=>{
  if(id==='sales'){setParams(item?{item}:{});return;}
  setParams(id==='training'?{view:'training'}:{view:'manage'});
 };
 const tabs=admin?([['sales','资料库'],['manage','资料管理'],['training','质量与训练']] as const):([['sales','资料库']] as const);
 return <section className="workspace-page"><div className={'panel '+(full?'':'xl:flex xl:h-[calc(100dvh_-_7rem)] xl:flex-col xl:overflow-hidden')}>
  {admin&&<nav aria-label="知识库视图" className={'flex flex-wrap items-center gap-1 rounded-t-xl border-b bg-muted/15 px-3 py-2 '+(full?'':'xl:shrink-0')}>
   {tabs.map(([id,label])=><button key={id} type="button" aria-current={active===id?'page':undefined} className={'min-h-11 rounded-md px-3 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring '+(active===id?'bg-primary/10 text-primary':'text-muted-foreground hover:bg-muted hover:text-foreground')} onClick={()=>tab(id)}>{label}</button>)}
   <span className="ml-auto hidden pr-1 text-xs leading-5 text-muted-foreground sm:block">{training?'用真实审核结果校准检索，不自动改模型权重':manage?'把文件收成资料，发布后助手才能用':'业务员在这里查已发布的资料'}</span>
  </nav>}
  {training?<KnowledgeTraining/>:manage?<KnowledgeAdmin key={key} initialKnowledgeId={requested==='manage'?item:undefined} initialDocumentId={params.get('document')??undefined} initialRevisionId={params.get('revision')??undefined} initialChunkId={params.get('chunk')??undefined}/>:<KnowledgeSalesLibrary key={key} admin={admin} initialId={item} onManage={id=>setParams(id?{view:'manage',knowledge:id}:{view:'manage'})} onImport={()=>setParams({view:'manage'})}/>}
 </div></section>;
}
