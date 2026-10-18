import {createServer} from 'node:http';
// Disposable S4 UI only. No real DB, mailbox workers, external model calls or production customers.
import {MongoMemoryServer} from 'mongodb-memory-server';
import {writeFile} from 'node:fs/promises';
process.env.NODE_ENV='test';process.env.AI_PROVIDER='mock';process.env.MAIL_CHANNEL='mock';process.env.KNOWLEDGE_RETRIEVAL_MODE='keyword';
async function main(){
 const db=await MongoMemoryServer.create({instance:{dbName:'s4_ui_fictional'}});const mongoose=await import('mongoose');await mongoose.connect(db.getUri());
 const {Project,User,Customer,DevelopmentLetter,hashPassword}=await import('../src/models');
 const project=await Project.create({name:'S4 虚构包装项目',slug:'s4-fictional',code:'S4DEMO',companyName:'FICTIONAL ONLY',mailProfileKey:'s4-fixture',isDefault:true});
 const user=await User.create({username:'s4-demo',passwordHash:await hashPassword(['S4','fictional','only'].join('-')),displayName:'知识管理员（独立测试）',role:'admin',projectIds:[project._id],defaultProjectId:project._id});
 const customer=await Customer.create({projectId:project._id,ownerId:user._id,name:'Fictional Buyer',company:'Independent Test Buyer',email:'fictional-buyer@example.test',interestedProducts:'velvet pouch',expectedQuantity:'150'});
 const actor={id:user.id,projectId:project.id,username:user.username,displayName:user.displayName,role:'admin' as const};
 const {appendKnowledge}=await import('../src/services/agent/knowledge.service');
 const terms=[{topic:'moq' as const,value:'73',unit:'pcs',conditions:'standard velvet pouch',mode:'confirmed' as const,scope:{reviewed:true,products:['velvet pouch'],processes:[],exclusions:[],polarity:'affirmed' as const}},{topic:'lead_time' as const,value:'19',unit:'working days',conditions:'after deposit and artwork approval',mode:'confirmed' as const,scope:{reviewed:true,products:['velvet pouch'],processes:[],startsAfter:'deposit and artwork approval',exclusions:[],polarity:'affirmed' as const}}];
 const knowledgeId=await appendKnowledge(undefined,{expectedVersion:0,title:'虚构绒布袋交易条件',category:'trade',source:'独立测试确认记录；不是公司真实政策',content:'Fictional velvet pouch policy only. No confirmed price or freight.',approved:true,products:['velvet pouch'],applicability:'仅用于独立验收',terms},actor);
 const {saveCustomerAgreement}=await import('../src/services/agent/customer-agreement.service');
 await saveCustomerAgreement(customer.id,undefined,{expectedVersion:0,title:'虚构客户单价约定',content:'Independent fictional approval, not a real agreement.',source:'fixture://s4-approved-correspondence',validFrom:new Date(Date.now()-86400000),validUntil:new Date(Date.now()+90*86400000),approved:true,terms:[{topic:'price',value:'4.25',unit:'per piece',currency:'USD',conditions:'150 standard velvet pouches; this fictional customer only',mode:'confirmed',scope:{reviewed:true,products:['velvet pouch'],processes:[],quantity:{min:150,max:150,minInclusive:true,maxInclusive:true,unit:'pcs'},exclusions:[],polarity:'affirmed',measure:'amount'}}]},actor);
 const {buildKnowledgeBundle,auditGroundedEmail}=await import('../src/services/agent/knowledge-grounding');const bundle=await buildKnowledgeBundle(actor,'velvet pouch MOQ lead time price freight quantity:150 pcs',{customerId:customer.id});
 const result=auditGroundedEmail('Our price is USD 999 and freight is free.',bundle,{taskType:'inquiry_reply',customerId:customer.id,recipientName:customer.name,seller:{companyName:project.companyName,senderName:user.displayName}});
 const letter=await DevelopmentLetter.create({projectId:project._id,customerId:customer._id,recipientName:customer.name,recipientEmail:customer.email,subject:'Regarding your inquiry',content:'<p>'+result.bodyText.replace(/\n/g,'<br>')+'</p>',contentText:result.bodyText,status:'draft',channel:'mock',template:'',knowledgeReview:result.review});
 const {createApp}=await import('../src/app');const app=createApp();const port=Number(process.env.S4_UI_PORT??5008);
 let http:ReturnType<typeof createServer>;
 const stop=()=>{http.close(()=>{void mongoose.disconnect().then(()=>db.stop()).then(()=>process.exit(0));});};
 http=createServer((req,res)=>{if(req.method==='POST'&&req.url==='/__s4_fixture_stop'){res.setHeader('content-type','application/json');res.end(JSON.stringify({stopping:true}));setTimeout(stop,100);}else app(req,res);});
 await new Promise<void>((resolve,reject)=>{http.once('error',reject);http.listen(port,'127.0.0.1',()=>resolve());});
 if(process.env.S4_UI_RECEIPT)await writeFile(process.env.S4_UI_RECEIPT,JSON.stringify({pid:process.pid,port,fictional:true,customerId:customer.id,letterId:letter.id,knowledgeId,projectId:project.id}));
 for(const signal of ['SIGINT','SIGTERM'] as const)process.once(signal,stop);
 console.log('S4 isolated fictional UI ready on '+port+'; no external AI or mail workers.');
}
void main().catch(e=>{console.error('S4 fixture failed: '+e.name);process.exit(1);});
