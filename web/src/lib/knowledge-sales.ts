import type {KnowledgeRevision,ProjectKnowledge,KnowledgeTerm} from '../types/knowledge';

export type SalesKnowledge = {id:string;revision:KnowledgeRevision;updatedAt:string};
export interface KnowledgeHandoff {requestId:string;projectId:string;userId:string;customerId:string;prompt:string}

// The server owns ACL/publication. A second display check prevents a later draft
// from being presented as the policy that a salesperson can use.
export function salesKnowledge(rows:ProjectKnowledge[],at=Date.now()):SalesKnowledge[]{
 return rows.flatMap(row=>{
  const revision=row.revisions.find(v=>v.version===row.approvedVersion);
  if(row.archived||!row.effective||!revision?.approved||!revision.validFrom)return [];
  const from=Date.parse(revision.validFrom),until=revision.validUntil?Date.parse(revision.validUntil):Infinity;
  if(!Number.isFinite(from)||from>at||Number.isNaN(until)||until<=at)return [];
  return [{id:row.id,revision,updatedAt:row.updatedAt}];
 });
}
export function matchesSalesKnowledge(item:SalesKnowledge,query:string,category:string){
 const v=item.revision;
 const text=[v.title,v.content,v.applicability,...v.tags,...(v.products??[]),...(v.terms??[]).flatMap(t=>[t.value,t.conditions,t.unit,t.currency])].join(' ').toLocaleLowerCase();
 return (category==='all'||v.category===category)&&query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean).every(q=>text.includes(q));
}
export function salesTitle(title:string){return title.replace(/^\s*\d+[.、．]\s*/,'');}
// Why did this entry match? Show the surrounding text so a full-text hit is not
// mistaken for a broken filter.
export function salesMatchExcerpt(item:SalesKnowledge,query:string,radius=40){
 const terms=query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
 if(!terms.length)return '';
 const v=item.revision;
 const text=[v.applicability??'',...(v.products??[]),v.content,...(v.terms??[]).flatMap(term=>[term.value,term.conditions,term.unit??'',term.currency??''])].filter(Boolean).join(' · ');
 const lower=text.toLocaleLowerCase();
 const index=Math.min(...terms.map(term=>{const at=lower.indexOf(term);return at<0?Infinity:at;}));
 if(!Number.isFinite(index))return '';
 const start=Math.max(0,index-radius),end=Math.min(text.length,index+radius*2);
 return (start>0?'…':'')+text.slice(start,end).replace(/\s+/g,' ').trim()+(end<text.length?'…':'');
}
export function salesExcerpt(content:string){return content.replace(/https?:\/\/\S+/g,'').replace(/[#*_>|]/g,' ').replace(/\s+/g,' ').trim().slice(0,130);}
export function knowledgeEmailPrompt(item:SalesKnowledge){
 return '帮我给这个客户写第一封开发信，参考「'+salesTitle(item.revision.title)+'」（已查看第'+item.revision.version+'版）。先检索当前项目已发布且适用的资料，核对产品和条件；资料已变或不适用时请提醒我。只使用有依据的卖点，缺少的信息列为待确认，不编造价格、MOQ、交期或认证。保存草稿交给我审核，不要发送邮件。';
}
export function acceptsKnowledgeHandoff(h:KnowledgeHandoff|null,projectId:string|undefined,userId:string|undefined,context:{type:string;resourceId?:string}){
 return !!h&&h.projectId===projectId&&h.userId===userId&&context.type==='customer'&&context.resourceId===h.customerId;
}


export function salesTermState(term:KnowledgeTerm,at=Date.now()){
 const scope=term.scope;
 if([scope?.validUntil,scope?.certificate?.validUntil].some(d=>d&&Date.parse(d)<=at))return '条件已过期，需重新确认';
 if(scope?.validFrom&&Date.parse(scope.validFrom)>at)return '条件尚未生效';
 return term.mode==='reference'?'仅参考，不是正式报价':term.mode==='confirmed'&&scope?.reviewed?'按已核对条件使用':'需人工确认';
}
export function salesTermDetails(term:KnowledgeTerm){
 const scope=term.scope;const lines:string[]=[];
 if(term.min!==undefined)lines.push('区间下限：'+term.min+' '+(term.unit??''));
 if(term.max!==undefined)lines.push('区间上限：'+term.max+' '+(term.unit??''));
 if(!scope)return lines;
 if(scope.products?.length)lines.push('适用产品：'+scope.products.join('、'));
 if(scope.processes?.length)lines.push('适用工艺：'+scope.processes.join('、'));
 const q=scope.quantity;
 if(q&&(q.min!==undefined||q.max!==undefined))lines.push('数量条件：'+[q.min===undefined?'':(q.minInclusive?'≥':'>')+q.min,q.max===undefined?'':(q.maxInclusive?'≤':'<')+q.max].filter(Boolean).join(' 且 ')+' '+q.unit);
 if(scope.startsAfter)lines.push('起算条件：'+scope.startsAfter);
 if(scope.origin)lines.push('起运地：'+scope.origin);
 if(scope.destination)lines.push('目的地：'+scope.destination);
 if(scope.incoterm)lines.push('贸易条款：'+scope.incoterm);
 if(scope.polarity==='denied')lines.push('否定条件：不提供，不可改写为可以提供');
 if(scope.validFrom)lines.push('条件生效：'+new Date(scope.validFrom).toLocaleDateString());
 if(scope.validUntil)lines.push('条件失效：'+new Date(scope.validUntil).toLocaleDateString());
 if(scope.exclusions?.length)lines.push('例外：'+scope.exclusions.join('；'));
 if(scope.certificate)lines.push('证书：'+scope.certificate.number+'；签发方：'+scope.certificate.issuer+'；覆盖产品：'+scope.certificate.products.join('、')+'；有效至：'+new Date(scope.certificate.validUntil).toLocaleDateString());
 return lines;
}
