import {createServer} from 'node:http';
import {randomBytes} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import {MongoMemoryServer} from 'mongodb-memory-server';
// Standalone fictional UI host: no production DB, workers, external AI or email.
Object.assign(process.env,{NODE_ENV:'test',AI_PROVIDER:'mock',MAIL_CHANNEL:'mock',KNOWLEDGE_RETRIEVAL_MODE:'keyword',JWT_SECRET:randomBytes(32).toString('hex'),IMAP_ENABLED:'false'});
async function main(){
 const memory=await MongoMemoryServer.create();process.env.MONGODB_URI=memory.getUri('prospecting_ui_fictional');
 const mongoose=await import('mongoose');await mongoose.connect(process.env.MONGODB_URI);
 const {Project,User,Customer,DevelopmentLetter,hashPassword}=await import('../src/models');
 const {Prospect}=await import('../src/models/Prospect');const {ProspectingConfig}=await import('../src/models/ProspectingConfig');
 const project=await Project.create({name:'今日开发 · 虚构验收',slug:'prospecting-ui-fictional',code:'PUI',companyName:'FICTIONAL ONLY',mailProfileKey:'prospect-fixture',isDefault:true});
 const user=await User.create({username:'prospect-demo',passwordHash:await hashPassword('Prospect-fictional-only'),displayName:'虚构验收管理员',role:'admin',projectIds:[project._id],defaultProjectId:project._id});
 await ProspectingConfig.create({projectId:project._id,ownerId:user._id,queries:['independent jewelry brand usa -site:etsy.com'],enrichLimit:10,hunterLimit:0,llmScoring:false});
 const candidate=await Prospect.create({projectId:project._id,day:new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai'}).format(new Date()),domain:'fictional-buyer.test',website:'https://fictional-buyer.test/',name:'Fictional Jewelry',company:'Fictional Jewelry Ltd',emails:['jane@fictional-buyer.test'],contactName:'Jane Example',contactTitle:'Founder',country:'US',phone:'+1 202 555 0123',address:'12 Fictional Street, Example City, CA, US',industry:'Jewelry',instagram:'https://instagram.com/fictionalbuyer',linkedin:'https://linkedin.com/company/fictionalbuyer',facebook:'https://facebook.com/fictionalbuyer',whatsapp:'https://wa.me/12025550123',excerpt:'Fictional jewelry company description from its website; not a purchase requirement.',sourceUrl:'https://fictional-buyer.test/contact',contactSources:[{source:'site',url:'https://fictional-buyer.test/contact',fields:['company','phone','address','country','instagram']}],score:85,scoreReasons:['虚构公开联系方式齐全'],status:'ready'});
 const customer=await Customer.create({projectId:project._id,ownerId:user._id,name:'Fictional Review Buyer',company:'Fictional Review Ltd',email:'review@fictional-review.test'});
 const letter=await DevelopmentLetter.create({projectId:project._id,customerId:customer._id,recipientName:customer.name,recipientEmail:customer.email,subject:'Fictional packaging introduction',content:'<p>Hello,</p><p>This is a fictional review draft for layout verification.</p>',contentText:'Hello,\nThis is a fictional review draft for layout verification.',status:'draft',channel:'mock',template:''});
 const {createApp}=await import('../src/app');const app=createApp();const port=Number(process.env.PROSPECT_UI_PORT??5021);
 const actualFetch=globalThis.fetch;globalThis.fetch=async(input,init)=>{const url=String(input);if(!/^https?:\/\/(?:localhost|127\.0\.0\.1)(?::|\/)/.test(url))throw Error('Fictional UI forbids external requests');return actualFetch(input,init);};
 const server=createServer((req,res)=>{if(req.method==='POST'&&req.url==='/__prospect_fixture_stop'){res.end('stopping');server.close(()=>{void mongoose.disconnect().then(()=>memory.stop()).then(()=>process.exit(0));});}else app(req,res);});
 await new Promise<void>(resolve=>server.listen(port,'127.0.0.1',resolve));
 if(process.env.PROSPECT_UI_RECEIPT)await writeFile(process.env.PROSPECT_UI_RECEIPT,JSON.stringify({fictional:true,pid:process.pid,port,projectId:project.id,customerId:customer.id,letterId:letter.id,prospectId:candidate.id}));
 console.log('Fictional prospecting UI ready on '+port+'; external requests disabled.');
}
void main().catch(error=>{console.error(error);process.exitCode=1;});
