import {KnowledgeIndex} from '@/components/agent/knowledge-index';
import {ProjectKnowledgeManager} from '@/components/agent/project-knowledge-manager';
import {KnowledgeDocuments} from '@/components/agent/knowledge-documents';
import {KnowledgeSalesLibrary} from '@/components/agent/knowledge-sales-library';
import {useAuthStore} from '@/store/auth.store';
import {useProjectStore} from '@/store/project.store';
import {useSearchParams} from 'react-router-dom';

export function KnowledgePage(){
 const user=useAuthStore(s=>s.user),admin=user?.role==='admin';
 const project=useProjectStore(s=>s.activeProject);
 const [params,setParams]=useSearchParams();
 // Keep existing source-review links, but start daily work with published material.
 const requested=params.get('view')??(admin&&params.has('knowledge')?'manage':'sales');
 const view=admin&&['manage','documents','index'].includes(requested)?requested:'sales';
 const manage=(id?:string)=>setParams({view:'manage',...(id?{knowledge:id}:{})});
 const key=project?.id+':'+user?.id;
 return <section className="workspace-page"><div className="workspace-surface overflow-hidden rounded-xl border bg-card">
 {admin&&<nav aria-label="知识库视图" className="flex flex-wrap gap-1 border-b bg-muted/15 px-3 py-2">{[['sales','销售资料'],['manage','资料审核与维护'],['documents','导入文件'],['index','检索维护']].map(([id,label])=><button key={id} type="button" aria-current={view===id?'page':undefined} className={'min-h-11 rounded-md px-3 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring '+(view===id?'bg-primary/10 text-primary':'text-muted-foreground hover:bg-muted hover:text-foreground')} onClick={()=>setParams(id==='sales'?{}:{view:id})}>{label}</button>)}</nav>}
 {view==='index'?<KnowledgeIndex key={key}/>:view==='documents'?<KnowledgeDocuments key={key} initialChunk={params.get('chunk')??undefined} initialDocument={params.get('document')??undefined} initialRevision={params.get('revision')??undefined} onReview={manage}/>:view==='manage'?<ProjectKnowledgeManager key={key} admin={admin} initialKnowledgeId={params.get('knowledge')??undefined}/>:<KnowledgeSalesLibrary key={key} admin={admin} initialId={params.get('item')??params.get('knowledge')??undefined} onManage={manage} onImport={()=>setParams({view:'documents'})}/>}
 </div></section>;
}
