import {ProjectKnowledgeManager} from '@/components/agent/project-knowledge-manager';
import {useAuthStore} from '@/store/auth.store';
import {useProjectStore} from '@/store/project.store';
export function KnowledgePage(){
 const admin=useAuthStore(s=>s.user?.role==='admin');
 const project=useProjectStore(s=>s.activeProject);
 return <section className="workspace-page"><div className="workspace-surface rounded-xl border bg-card"><ProjectKnowledgeManager key={project?.id} admin={admin}/></div></section>;
}
