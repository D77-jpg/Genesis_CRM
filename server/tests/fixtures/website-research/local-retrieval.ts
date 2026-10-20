// Exercise the same TS/CommonJS entry and dynamic-import loader as dev:workspace.
// ESM --eval imports of CommonJS output expose different namespaces in Node 20/24.
import mongoose from 'mongoose';
import type {AuthUser} from '../../../src/types/express';
import {semanticKnowledge} from '../../../src/services/knowledge/index.service';
async function main(){
 const actor=JSON.parse(process.env.WEBSITE_RESEARCH_ACTOR_JSON!) as AuthUser;
 await mongoose.connect(process.env.MONGODB_URI!);
 try{
  const result=await semanticKnowledge(actor,'synthetic diagnostics',{topics:[],productApplies:()=>true,sourceOf:()=>{throw Error('no corpus');}});
  console.log(JSON.stringify({status:result.status,code:result.issues[0]?.code}));
 }finally{await mongoose.disconnect();}
}
void main().catch(error=>{console.error(error);process.exitCode=1;});
