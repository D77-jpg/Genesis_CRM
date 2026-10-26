import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {MongoMemoryServer} from 'mongodb-memory-server';
import mongoose,{Types} from 'mongoose';
import {Project} from '../src/models/Project';
import {User} from '../src/models/User';
import {KnowledgeFeedback} from '../src/models/KnowledgeFeedback';
import {KnowledgeTrainingState} from '../src/models/KnowledgeTrainingState';
import {
  MAX_FEEDBACK_BOOST,
  feedbackBoostsForQuery,
  recordLetterReviewFeedback,
  reorderHitsWithFeedback,
  setTrainingEnabled,
  trainingOverview,
} from '../src/services/agent/knowledge-training';
import type {KnowledgeReview} from '../src/services/agent/knowledge-types';
import type {AuthUser} from '../src/types/express';

process.env.NODE_ENV='test';
const project=new Types.ObjectId(),foreign=new Types.ObjectId(),adminId=new Types.ObjectId(),salesId=new Types.ObjectId();
const actor:AuthUser={id:String(adminId),projectId:String(project),username:'c-admin',displayName:'Fictional C admin',role:'admin'};
const sales:AuthUser={...actor,id:String(salesId),role:'user'};
let memory:MongoMemoryServer;

function review(letterId:Types.ObjectId, request='zipper pouch MOQ', sourceId=String(new Types.ObjectId())):KnowledgeReview {
  return {
    version:1, projectId:String(project), taskType:'first_outreach', generatedAt:new Date().toISOString(),
    status:'ready', completeness:'complete', sources:[{
      sourceId:'knowledge:'+sourceId, knowledgeId:sourceId, version:1, title:'Fictional zipper pouch policy',
      category:'product', kind:'knowledge', content:'Fictional zipper pouch MOQ is 200 pcs.', source:'fixture://c',
      applicability:'FICTIONAL ONLY', products:['zipper pouch'], validFrom:'2020-01-01',
      terms:[{topic:'moq',value:'200',conditions:'FICTIONAL ONLY',unit:'pcs',mode:'confirmed'}],
    }], claims:[{text:'Fictional zipper pouch MOQ is 200 pcs.',sourceIds:['knowledge:'+sourceId]}], questions:[], issues:[], context:{request}, bodyHash:'a'.repeat(64),
  } as unknown as KnowledgeReview;
}

async function record(letterId:Types.ObjectId, decision:'approved'|'rejected', sourceId:string, request='zipper pouch MOQ'){
  await recordLetterReviewFeedback({
    _id:letterId, projectId:project, customerId:new Types.ObjectId(), subject:'Fictional zipper pouch',
    contentText:'Fictional zipper pouch MOQ is 200 pcs for this fictional customer.',
    aiSnapshot:{subject:'Fictional zipper pouch',contentText:'Fictional zipper pouch MOQ is 200 pcs.',at:new Date()},
    knowledgeReview:review(letterId,request,sourceId),
  },decision,actor,{note:'fictional review'});
}

before(async()=>{
  memory=await MongoMemoryServer.create();
  await mongoose.connect(memory.getUri('c_fictional_only'));
  await Project.create([{_id:project,name:'FICTIONAL C',slug:'c-fictional',code:'C',companyName:'FICTIONAL ONLY',mailProfileKey:'c'}, {_id:foreign,name:'FOREIGN C',slug:'c-foreign',code:'CB',companyName:'FICTIONAL ONLY',mailProfileKey:'cb'}]);
  await User.create([{_id:adminId,username:'c-admin',passwordHash:'not-a-login',displayName:'C',role:'admin',projectIds:[project,foreign]}, {_id:salesId,username:'c-sales',passwordHash:'not-a-login',displayName:'C sales',role:'user',projectIds:[project]}]);
});

after(async()=>{await mongoose.disconnect();await memory?.stop();});

test('C 01 审核通过自动沉淀 AI 原稿、人工终稿与采用的来源',async()=>{
  const letterId=new Types.ObjectId(), sourceId=String(new Types.ObjectId());
  await record(letterId,'approved',sourceId);
  const sample=await KnowledgeFeedback.findOne({letterId});
  assert.ok(sample);
  assert.equal(sample.decision,'approved');
  assert.equal(sample.edited,true);
  assert.ok(sample.editRatio>0&&sample.editRatio<=1);
  assert.deepEqual(sample.sourceIds,[sourceId]);
  assert.ok(sample.queryTerms.includes('zipper'));
  assert.equal(sample.status,'included');
  assert.equal(sample.aiBody,'Fictional zipper pouch MOQ is 200 pcs.');
});

test('C 01b 只把最终稿仍保留的 claim 来源标为正样本，未采用来源不训练',async()=>{
  const letterId=new Types.ObjectId(),used=new Types.ObjectId().toString(),unused=new Types.ObjectId().toString();
  const base=review(letterId,'zipper pouch MOQ',used);
  const extra=(base.sources[0] as unknown as Record<string,unknown>);
  (base.sources as unknown as Record<string,unknown>[]).push({...extra,sourceId:'knowledge:'+unused,knowledgeId:unused,title:'Unused fictional source'});
  await recordLetterReviewFeedback({
    _id:letterId,projectId:project,customerId:new Types.ObjectId(),subject:'Fictional zipper pouch',
    contentText:'Fictional zipper pouch MOQ is 200 pcs for this fictional customer.',
    aiSnapshot:{subject:'Fictional zipper pouch',contentText:'Fictional zipper pouch MOQ is 200 pcs.',at:new Date()},
    knowledgeReview:base,
  },'approved',actor);
  const sample=await KnowledgeFeedback.findOne({letterId});
  assert.ok(sample);assert.deepEqual(sample.sourceIds,[used]);
});

test('C 02 没有 AI 快照的旧稿不生成样本，也没有跨项目泄露',async()=>{  const oldId=new Types.ObjectId();
  await recordLetterReviewFeedback({_id:oldId,projectId:project,customerId:new Types.ObjectId(),subject:'Old',contentText:'Old',knowledgeReview:review(oldId)},'approved',actor);
  assert.equal(await KnowledgeFeedback.exists({letterId:oldId}),null);
  assert.equal(await KnowledgeFeedback.exists({projectId:foreign}),null);
});

test('C 03 自动校准默认关闭，启用后只对相似且审核通过的来源产生有界加权',async()=>{
  const source=new Types.ObjectId().toString();
  for(let i=0;i<3;i++)await record(new Types.ObjectId(),'approved',source);
  const disabled=await feedbackBoostsForQuery(String(project),'zipper pouch MOQ');
  assert.equal(disabled.enabled,false);
  assert.equal(disabled.boosts.size,0);

  await setTrainingEnabled(actor,true);
  const enabled=await feedbackBoostsForQuery(String(project),'zipper pouch MOQ');
  assert.equal(enabled.enabled,true);
  assert.ok(enabled.samples>=3);
  const boost=enabled.boosts.get(source);
  assert.ok(boost&&boost>0&&boost<=MAX_FEEDBACK_BOOST);
  assert.equal(enabled.boosts.has(new Types.ObjectId().toString()),false);

  const unrelated=await feedbackBoostsForQuery(String(project),'steel frame welding');
  assert.equal(unrelated.boosts.size,0);

  await KnowledgeTrainingState.updateOne({projectId:project},{$set:{enabled:false}});
  const off=await feedbackBoostsForQuery(String(project),'zipper pouch MOQ');
  assert.equal(off.boosts.size,0);
});

test('C 04 不通过样本只做统计，不会进入来源加权；撤销审核会撤出样本',async()=>{
  const rejectedId=new Types.ObjectId(),rejectedSource=new Types.ObjectId().toString();
  await record(rejectedId,'rejected',rejectedSource);
  await setTrainingEnabled(actor,true);
  const rejectedOnly=await feedbackBoostsForQuery(String(project),'zipper pouch MOQ');
  assert.equal(rejectedOnly.boosts.has(rejectedSource),false);
  await KnowledgeFeedback.updateMany({projectId:project},{$set:{status:'retracted'}});
  const result=await feedbackBoostsForQuery(String(project),'zipper pouch MOQ');
  assert.equal(result.boosts.size,0);
  const summary=await trainingOverview(actor);
  assert.equal(summary.total,0);
});

test('C 05 只重排已接受命中，不把未达阈值候选推入来源',async()=>{
  const itemToKnowledge=new Map([['item-a','source-a'],['item-b','source-b']]);
  const hits=[
    {id:'item-a',accepted:true,rank:1},
    {id:'item-b',accepted:false,rank:2},
    {id:'item-c',accepted:true,rank:3},
  ];
  const reordered=reorderHitsWithFeedback(hits,itemToKnowledge,new Map([['source-b',0.02]]));
  assert.deepEqual(reordered.map(hit=>hit.id),['item-a','item-c','item-b']);
  assert.equal(reordered[2].accepted,false);
});

test('C 06 训练概况和开关仅管理员可访问，且只返回本项目摘要',async()=>{
  await assert.rejects(()=>trainingOverview(sales));
  await assert.rejects(()=>setTrainingEnabled(sales,true));
  const overview=await trainingOverview(actor);
  assert.equal(overview.limits.onlyApproved,true);
  assert.equal(overview.limits.maxBoost,MAX_FEEDBACK_BOOST);
  assert.ok(Array.isArray(overview.recent));
  assert.ok(overview.recent.every(item=>!('aiBody' in item)&&!('finalBody' in item)));
});
