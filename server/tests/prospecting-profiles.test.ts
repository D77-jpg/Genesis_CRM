import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {Types} from 'mongoose';
import {MongoMemoryServer} from 'mongodb-memory-server';
import {extractSiteContact} from '../src/services/prospecting/lead-contact';
import {enrichLead,type RawLead} from '../src/services/prospecting/lead-source';
import {mapHunterResponse} from '../src/services/prospecting/hunter';
import {prospectCustomerInput} from '../src/services/prospecting/prospect-customer';
import {getProspectingConfig,updateProspectingConfig,startProspecting,approveProspect,claimProspect,releaseProspect,prospectingToday,syncProspectCustomer,refreshProspectContact} from '../src/services/prospecting/prospecting.service';
import {ProspectingConfig} from '../src/models/ProspectingConfig';
import {ProspectingRun} from '../src/models/ProspectingRun';
import {Prospect} from '../src/models/Prospect';
import {AgentTask} from '../src/models/AgentTask';
import {prospectingConfigSchema,runProspectingSchema} from '../src/validators/prospecting.validator';
import type {AuthUser} from '../src/types/express';

const structured='<script type="application/ld+json">'+JSON.stringify({'@context':'https://schema.org','@graph':[{'@type':'Organization',url:'https://buyer.test/',legalName:'Fictional Buyer Ltd',telephone:'+1 202 555 0100',industry:'Jewelry',address:{streetAddress:'12 Fictional Street',addressLocality:'Example City',addressRegion:'CA',postalCode:'90001',addressCountry:'US'},sameAs:['https://www.linkedin.com/company/fictional-buyer','https://instagram.com/fictionalbuyer']}]})+'</script>';
const lead:RawLead={domain:'buyer.test',website:'https://buyer.test/',name:'Top 30 Jewelry Manufacturers',sourceUrl:'https://buyer.test/directory'};
const fields={company:'Fictional Buyer Ltd',country:'US',phone:'+1 202 555 0100',address:'12 Fictional Street, Example City, CA, 90001, US',industry:'Jewelry',instagram:'https://instagram.com/fictionalbuyer',linkedin:'https://www.linkedin.com/company/fictional-buyer'};

test('explicit website structured fields retain full addresses and social paths; prose never becomes purchase intent',()=>{
 assert.deepEqual(extractSiteContact('We sell jewelry and expect large sales.',structured,lead.domain),fields);
 assert.deepEqual(extractSiteContact('We sell jewelry in the USA.','',lead.domain),{});
 const malicious=structured.replace('https://buyer.test/','https://other.example/');
 assert.equal(extractSiteContact('',malicious,lead.domain).company,undefined);
 assert.equal(extractSiteContact('[Click](https://instagram.com.evil.example/brand)','',lead.domain).instagram,undefined);
 const labelled=extractSiteContact('Phone: +44 20 7946 0100\nAddress: 1 Fictional Road\nCountry: UK\nIndustry: Retail','',lead.domain);
 assert.equal(labelled.phone,'+44 20 7946 0100');assert.equal(labelled.address,'1 Fictional Road');assert.equal(labelled.country,'UK');assert.equal(labelled.industry,'Retail');
});

test('finding an email on the homepage does not stop contact/about collection; calls stay capped at three',async()=>{
 const visited:string[]=[];
 const result=await enrichLead(lead,async url=>{visited.push(url);return url===lead.website?{markdown:'hello@buyer.test [Contact](/pages/contact-us) [About](/pages/about-us)'}:url.includes('contact')?{markdown:'[Telephone](tel:+12025550100) [Facebook](https://facebook.com/fictionalbuyer)',rawHtml:structured}:{markdown:'About our fictional jewelry brand.'};});
 assert.deepEqual(visited,[lead.website,'https://buyer.test/pages/contact-us','https://buyer.test/pages/about-us']);
 assert.equal(result.company,fields.company);assert.equal(result.country,'US');assert.equal(result.facebook,'https://facebook.com/fictionalbuyer');assert.equal(result.emails?.[0],'hello@buyer.test');assert.ok(result.excerpt?.includes('About our fictional'));
 assert.ok(result.contactSources?.some(s=>s.url.includes('contact')&&s.fields.includes('address')));
});

test('Hunter contact details stay attached to the selected email and organization is retained',()=>{
 const result=mapHunterResponse({data:{domain:lead.domain,organization:'Fictional Buyer Ltd',emails:[{value:'info@buyer.test',type:'generic',confidence:98},{value:'jane@buyer.test',type:'personal',confidence:95,first_name:'Jane',last_name:'Doe',position:'Founder',phone_number:'+1 202 555 0123',linkedin:'https://linkedin.com/in/jane-fictional'}]}});
 assert.equal(result.emails[0].value,'jane@buyer.test');assert.equal(result.contactName,'Jane Doe');assert.equal(result.contactTitle,'Founder');assert.equal(result.organization,fields.company);assert.equal(result.phone,'+1 202 555 0123');assert.equal(result.linkedin,'https://linkedin.com/in/jane-fictional');
 const generic=mapHunterResponse({data:{emails:[{value:'info@buyer.test',type:'generic',confidence:99},{value:'jane@buyer.test',type:'generic',confidence:20,first_name:'Jane',position:'Designer'}]}});
 assert.equal(generic.contactName,undefined);assert.equal(generic.contactTitle,undefined);
});

test('conversion retains every acquired field and source, without creating inferred buying requirements',()=>{
 const input=prospectCustomerInput({...lead,...fields,emails:['jane@buyer.test','hello@buyer.test'],score:90,contactName:'Jane Doe',contactTitle:'Founder',facebook:'https://facebook.com/fictionalbuyer',whatsapp:'https://wa.me/12025550100',excerpt:'Our brand sells necklaces.',contactSources:[{source:'site',url:lead.website,fields:['company','country']}]});
 for(const [key,value] of Object.entries(fields))assert.equal(input[key as keyof typeof input],value);
 assert.equal(input.name,'Jane Doe');assert.equal(input.title,'Founder');assert.equal(input.facebook,'https://facebook.com/fictionalbuyer');assert.equal(input.whatsapp,'https://wa.me/12025550100');
 assert.ok(input.notes?.includes('hello@buyer.test'));assert.ok(input.notes?.includes('Our brand sells necklaces.'));assert.ok(input.notes?.includes(lead.website));
 assert.equal(input.interestedProducts,undefined);assert.equal(input.expectedQuantity,undefined);
 const old=prospectCustomerInput({...lead,company:lead.name,emails:['info@buyer.test'],score:60});assert.equal(old.name,lead.domain);assert.equal(old.company,lead.domain);
});

let memory:MongoMemoryServer,mongoose:typeof import('mongoose');
let actor:AuthUser;const otherProject=String(new Types.ObjectId());
const profile=(id:string,name=id)=>({id,name,queries:['jewelry brand '+id],enrichLimit:1,hunterLimit:0,minScore:0,llmScoring:false});
before(async()=>{memory=await MongoMemoryServer.create();mongoose=await import('mongoose');await mongoose.default.connect(memory.getUri(),{dbName:'prospect-profiles-isolated'});const {Project,User}=await import('../src/models');const project=await Project.create({name:'Fictional profiles',slug:'fictional-profiles',code:'FPROF',companyName:'Fictional Only',mailProfileKey:'profiles-fixture',isDefault:true});const user=await User.create({username:'profiles-fixture',displayName:'Fixture',passwordHash:'not-a-login-password',role:'admin',projectIds:[project._id],defaultProjectId:project._id});actor={id:user.id,username:user.username,displayName:'Fixture',role:'admin',projectId:project.id};});
after(async()=>{await mongoose.default.disconnect();await memory.stop();});

test('existing single settings become a named profile without losing zero limits or touching other projects',async()=>{
 await ProspectingConfig.create({projectId:actor.projectId,queries:['existing jewelry search'],enrichLimit:7,hunterLimit:0,minScore:0,llmScoring:false});
 const config=await getProspectingConfig(actor);assert.equal(config.profiles.length,1);assert.equal(config.profiles[0].name,'原默认方案');assert.deepEqual(config.profiles[0].queries,['existing jewelry search']);assert.equal(config.profiles[0].hunterLimit,0);assert.equal(config.profiles[0].minScore,0);assert.equal(config.profiles[0].llmScoring,false);
 const foreign=await getProspectingConfig({...actor,projectId:otherProject});assert.notDeepEqual(foreign.profiles[0].queries,config.profiles[0].queries);
});

test('profile saves persist defaults, reject stale edits, invalid selections and duplicate IDs/names',async()=>{
 const initial=await getProspectingConfig(actor);const updated=await updateProspectingConfig(actor,prospectingConfigSchema.parse({version:initial.version,profiles:[profile('a','Jewelry'),profile('b','Candles')],activeProfileId:'b'}));
 assert.equal(updated?.activeProfileId,'b');assert.deepEqual(updated?.queries,profile('b').queries);
 assert.equal((await getProspectingConfig(actor)).profiles.length,2);
 await assert.rejects(()=>updateProspectingConfig(actor,{version:initial.version,enabled:true}),/其他人修改/);
 await assert.rejects(()=>updateProspectingConfig(actor,{activeProfileId:'foreign'}),/必须是已保存/);
 assert.throws(()=>prospectingConfigSchema.parse({profiles:[profile('a'),profile('a','Other')]}));
 assert.throws(()=>prospectingConfigSchema.parse({profiles:[profile('a','Same'),profile('b','same')]}));
 assert.throws(()=>prospectingConfigSchema.parse({profiles:[]}));assert.throws(()=>runProspectingSchema.parse({profileId:'bad/id'}));
});

test('a chosen run snapshots settings and does not overwrite defaults even if config changes in flight',async()=>{
 const actualFetch=globalThis.fetch;let release:()=>void=()=>{};const paused=new Promise<void>(resolve=>{release=resolve;});let searchStarted:()=>void=()=>{};const started=new Promise<void>(resolve=>{searchStarted=resolve;});
 process.env.LEAD_SERPER_API_KEY='fictional-key';process.env.LEAD_FIRECRAWL_API_KEY='fictional-key';
 globalThis.fetch=async(input,init)=>{const url=String(input);if(url==='https://google.serper.dev/search'){searchStarted();await paused;return new Response(JSON.stringify({organic:[{title:lead.name,link:lead.website,snippet:'Fictional handmade jewelry shop'}]}));}if(url==='https://api.firecrawl.dev/v1/scrape'){const payload=JSON.parse(String(init?.body));return new Response(JSON.stringify({success:true,data:{markdown:payload.url===lead.website?'hello@buyer.test [Contact](/contact) [About](/about)':'Explicit contact details.',rawHtml:structured}}));}throw Error('Unexpected network request '+url);};
 try{
  const run=await startProspecting(actor,{profileId:'a',queries:['one-off fictional query'],enrichLimit:1});await started;
  const config=await getProspectingConfig(actor);assert.equal(config.activeProfileId,'b');assert.equal(config.enrichLimit,1);
  await updateProspectingConfig(actor,{version:config.version,profiles:[{...profile('a','Jewelry'),enrichLimit:8,hunterLimit:9,minScore:99},profile('b','Candles')],activeProfileId:'b'});
  release();
  let complete=await ProspectingRun.findById(run.id);const until=Date.now()+10000;
  while(complete?.status==='running'&&Date.now()<until){await new Promise(resolve=>setTimeout(resolve,20));complete=await ProspectingRun.findById(run.id);}
  assert.equal(complete?.status,'completed');assert.equal(complete?.profileId,'a');assert.deepEqual(complete?.queries,['one-off fictional query']);assert.equal(complete?.settings?.enrichLimit,1);assert.equal(complete?.settings?.hunterLimit,0);assert.equal(complete?.settings?.minScore,0);
  const stored=await Prospect.findOne({projectId:actor.projectId,domain:lead.domain});assert.ok(stored);for(const [key,value] of Object.entries(fields))assert.equal(stored.get(key),value,key);
  const converted=await approveProspect(actor,stored.id);assert.equal(converted.customer.country,'美国') /* 客户记录统一存中文简称 */;assert.equal(converted.draftTaskIds?.length,3);const sequenceTasks=await AgentTask.find({projectId:actor.projectId,customerId:converted.customer.id}).select('outreachStep').lean();assert.deepEqual(sequenceTasks.map(task=>task.outreachStep).sort(),[1,2,3]);assert.equal(converted.customer.phone,fields.phone);assert.equal(converted.customer.address,fields.address);assert.equal(converted.customer.industry,fields.industry);assert.equal(converted.customer.instagram,fields.instagram);assert.ok(converted.customer.notes?.includes('网站自述'));
  const today=await prospectingToday(actor);assert.equal(today.prospects.find(p=>p.id===stored.id)?.country,'US');assert.equal(today.prospects.find(p=>p.id===stored.id)?.linkedin,fields.linkedin);
  const {Customer}=await import('../src/models');
  await Customer.updateOne({_id:converted.customer.id},{$unset:{country:1,instagram:1},$set:{phone:'Manually edited phone',notes:'My manual note'}});
  const synced=await syncProspectCustomer(actor,stored.id);assert.equal(synced.customer.country,'美国');assert.equal(synced.customer.instagram,fields.instagram);assert.equal(synced.customer.phone,'Manually edited phone');assert.ok(synced.customer.notes?.startsWith('My manual note'));
  const again=await syncProspectCustomer(actor,stored.id);assert.deepEqual(again.filledFields,[]);assert.equal(again.customer.notes,synced.customer.notes);
  await assert.rejects(()=>syncProspectCustomer({...actor,projectId:otherProject},stored.id));
  await assert.rejects(()=>syncProspectCustomer({...actor,id:String(new Types.ObjectId()),role:'user'},stored.id));
  await assert.rejects(()=>approveProspect({...actor,projectId:otherProject},stored.id));
 }finally{release();globalThis.fetch=actualFetch;delete process.env.LEAD_SERPER_API_KEY;delete process.env.LEAD_FIRECRAWL_API_KEY;}
});


test('a salesperson can start a search once a day and generated leads go to their personal pool',async()=>{
 const {User}=await import('../src/models');
 const sales=await User.create({username:'search-owner-fixture',displayName:'Search Owner',passwordHash:'not-a-login-password',role:'user',projectIds:[actor.projectId],defaultProjectId:actor.projectId});
 const salesActor:AuthUser={id:sales.id,username:sales.username,displayName:sales.displayName,role:'user',projectId:actor.projectId};
 const salesLead={...lead,domain:'sales-run.test',website:'https://sales-run.test/'};
 const actualFetch=globalThis.fetch;
 process.env.LEAD_SERPER_API_KEY='fictional-key';process.env.LEAD_FIRECRAWL_API_KEY='fictional-key';
 globalThis.fetch=async(input,init)=>{
  const url=String(input);
  if(url==='https://google.serper.dev/search')return new Response(JSON.stringify({organic:[{title:'Fictional Search Lead',link:salesLead.website,snippet:'Fictional handmade jewelry shop'}]}));
  if(url==='https://api.firecrawl.dev/v1/scrape'){
   const payload=JSON.parse(String(init?.body));
   return new Response(JSON.stringify({success:true,data:{markdown:payload.url===salesLead.website?'hello@sales-run.test [Contact](/contact) [About](/about)':'Explicit contact details.',rawHtml:structured.replaceAll('buyer.test','sales-run.test')}}));
  }
  throw Error('Unexpected network request '+url);
 };
 try{
  const run=await startProspecting(salesActor,{profileId:'a',queries:['sales-run fictional query'],enrichLimit:1});
  let complete=await ProspectingRun.findById(run.id);const until=Date.now()+10000;
  while(complete?.status==='running'&&Date.now()<until){await new Promise(resolve=>setTimeout(resolve,20));complete=await ProspectingRun.findById(run.id);}
  assert.equal(complete?.status,'completed');
  const stored=await Prospect.findOne({projectId:actor.projectId,domain:salesLead.domain}).lean();
  assert.equal(String(stored?.ownerId),String(sales._id));
  const mine=await prospectingToday(salesActor,{scope:'mine'});
  assert.ok(mine.prospects.some(p=>p.id===String(stored?._id)));
  await assert.rejects(()=>startProspecting(salesActor,{profileId:'a',queries:['second run'],enrichLimit:1}),/今天已经生成过一轮/);
 }finally{globalThis.fetch=actualFetch;delete process.env.LEAD_SERPER_API_KEY;delete process.env.LEAD_FIRECRAWL_API_KEY;}
});

test('salesperson scopes are disjoint and claiming/converting assigns the salesperson as owner',async()=>{
 const {User,Customer}=await import('../src/models');
 const sales=await User.create({username:'prospect-sales-a',displayName:'Sales A',passwordHash:'not-a-login-password',role:'user',projectIds:[actor.projectId],defaultProjectId:actor.projectId});
 const other=await User.create({username:'prospect-sales-b',displayName:'Sales B',passwordHash:'not-a-login-password',role:'user',projectIds:[actor.projectId],defaultProjectId:actor.projectId});
 const salesActor:AuthUser={id:sales.id,username:sales.username,displayName:sales.displayName,role:'user',projectId:actor.projectId};
 const day='2026-10-28';
 const shared=await Prospect.create({projectId:actor.projectId,day,domain:'shared-owner.test',website:'https://shared-owner.test',emails:['a@shared-owner.test'],status:'ready',score:80});
 const mine=await Prospect.create({projectId:actor.projectId,day,domain:'mine-owner.test',website:'https://mine-owner.test',emails:['b@mine-owner.test'],status:'ready',score:80,ownerId:sales._id});
 const foreign=await Prospect.create({projectId:actor.projectId,day,domain:'foreign-owner.test',website:'https://foreign-owner.test',emails:['c@foreign-owner.test'],status:'ready',score:80,ownerId:other._id});

 const sharedView=await prospectingToday(salesActor,{scope:'shared'});
 assert.ok(sharedView.prospects.some(p=>p.id===String(shared._id)));
 assert.ok(!sharedView.prospects.some(p=>p.id===String(mine._id)));
 assert.ok(!sharedView.prospects.some(p=>p.id===String(foreign._id)));
 const mineView=await prospectingToday(salesActor,{scope:'mine'});
 assert.ok(mineView.prospects.some(p=>p.id===String(mine._id)));
 assert.ok(!mineView.prospects.some(p=>p.id===String(shared._id)));
 assert.equal(sharedView.scopeTotals?.shared,1);assert.equal(mineView.scopeTotals?.mine,1);

 await assert.rejects(()=>claimProspect(salesActor,foreign.id),/其他业务员领取/);
 const claimed=await claimProspect(salesActor,shared.id);
 assert.equal(claimed.ownerId,String(sales._id));
 const afterClaim=await prospectingToday(salesActor,{scope:'shared'});
 assert.ok(!afterClaim.prospects.some(p=>p.id===String(shared._id)));
 const released=await releaseProspect(salesActor,shared.id);
 assert.equal(released.ownerId,undefined);
 assert.ok((await prospectingToday(salesActor,{scope:'shared'})).prospects.some(p=>p.id===String(shared._id)));
 await claimProspect(salesActor,shared.id);
 const converted=await approveProspect(salesActor,shared.id);
 const customer=await Customer.findById(converted.customer.id).lean();
 assert.equal(String(customer?.ownerId),String(sales._id));
 const stored=await Prospect.findById(shared._id).lean();
 assert.equal(String(stored?.ownerId),String(sales._id));
 assert.equal(String(stored?.convertedBy),String(sales._id));

 // 管理员从团队视图代转：客户负责人保持原业务员，不会被改成管理员
 const teamLead=await Prospect.create({projectId:actor.projectId,day,domain:'team-convert.test',website:'https://team-convert.test',emails:['d@team-convert.test'],status:'ready',score:80,ownerId:other._id});
 const teamConverted=await approveProspect(actor,teamLead.id);
 const teamCustomer=await Customer.findById(teamConverted.customer.id).lean();
 assert.equal(String(teamCustomer?.ownerId),String(other._id));
});

test('legacy website re-acquisition is explicit, capped, permission-scoped and fills only missing customer data',async()=>{
 const actualFetch=globalThis.fetch,stored=await Prospect.findOne({projectId:actor.projectId,domain:lead.domain});assert.ok(stored?.customerId);
 const {Customer}=await import('../src/models');await Prospect.updateOne({_id:stored.id},{$unset:{address:1,country:1}});await Customer.updateOne({_id:stored.customerId},{$unset:{address:1,country:1},$set:{phone:'Keep manual phone'}});
 let calls=0;globalThis.fetch=async(input)=>{assert.equal(String(input),'https://api.firecrawl.dev/v1/scrape');calls++;return new Response(JSON.stringify({success:true,data:{markdown:'',rawHtml:structured}}));};process.env.LEAD_FIRECRAWL_API_KEY='fictional-key';
 try{
  await assert.rejects(()=>refreshProspectContact({...actor,role:'user'},stored.id));assert.equal(calls,0);
  await assert.rejects(()=>refreshProspectContact({...actor,projectId:otherProject},stored.id));assert.equal(calls,0);
  const refreshed=await refreshProspectContact(actor,stored.id);assert.equal(calls,3);assert.equal(refreshed.prospect?.country,'US');
  const customer=await Customer.findById(stored.customerId);assert.equal(customer?.country,'美国');assert.equal(customer?.address,fields.address);assert.equal(customer?.phone,'Keep manual phone');
  await assert.rejects(()=>refreshProspectContact(actor,stored.id),/刚刚更新/);assert.equal(calls,3);
 }finally{globalThis.fetch=actualFetch;delete process.env.LEAD_FIRECRAWL_API_KEY;}
});
