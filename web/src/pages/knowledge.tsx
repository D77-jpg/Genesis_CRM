import {ProjectKnowledgeManager} from '@/components/agent/project-knowledge-manager';
import {KnowledgeDocuments} from '@/components/agent/knowledge-documents';
import {useAuthStore} from '@/store/auth.store';
import {useProjectStore} from '@/store/project.store';
import {useSearchParams} from 'react-router-dom';
export function KnowledgePage(){
 const admin=useAuthStore(s=>s.user?.role==='admin');
 const project=useProjectStore(s=>s.activeProject);
 const [params,setParams]=useSearchParams();
 const documents=admin&&params.get('view')==='documents';
 return <section className="workspace-page"><div className="workspace-surface rounded-xl border bg-card">
 {admin&&<nav aria-label="知识库视图" className="flex gap-2 border-b p-3"><button type="button" aria-current={!documents?'page':undefined} className={'min-h-11 rounded-md px-4 text-sm font-medium focus-visible:ring-2 focus-visible:ring-ring '+(!documents?'bg-primary/10 text-primary':'text-muted-foreground hover:bg-muted')} onClick={()=>setParams({})}>知识条目</button><button type="button" aria-current={documents?'page':undefined} className={'min-h-11 rounded-md px-4 text-sm font-medium focus-visible:ring-2 focus-visible:ring-ring '+(documents?'bg-primary/10 text-primary':'text-muted-foreground hover:bg-muted')} onClick={()=>setParams({view:'documents'})}>资料导入与审核</button></nav>}
 {documents?<KnowledgeDocuments key={project?.id} initialDocument={params.get('document')??undefined} initialRevision={params.get('revision')??undefined} onReview={id=>setParams({knowledge:id})}/>:<ProjectKnowledgeManager key={project?.id} admin={admin} initialKnowledgeId={params.get('knowledge')??undefined}/>}
 </div></section>;
}
