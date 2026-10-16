import {ProjectKnowledgeManager} from './project-knowledge-manager';
export function AgentKnowledge({admin,customerId}:{admin:boolean;customerId?:string}){
 return <ProjectKnowledgeManager admin={admin} customerId={customerId}/>;
}
