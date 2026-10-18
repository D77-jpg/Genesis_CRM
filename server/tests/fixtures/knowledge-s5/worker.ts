import mongoose from 'mongoose';
process.env.NODE_ENV='test';process.env.AI_PROVIDER='mock';process.env.MAIL_CHANNEL='mock';process.env.KNOWLEDGE_RETRIEVAL_MODE='keyword';
async function main(){
 await mongoose.connect(process.env.S5_TEST_MONGO!,{dbName:process.env.S5_TEST_DB});const {MockAgentProvider}=await import('../../../src/services/agent/mock-provider');const base=new MockAgentProvider();const {processAgentTask}=await import('../../../src/services/agent/task.service');
 const provider=Object.create(base);Object.defineProperty(provider,'name',{value:'openai'});Object.defineProperty(provider,'model',{value:'s5-protocol-fixture-not-real-model'});
 provider.analyzeCustomer=async(input:Parameters<typeof base.analyzeCustomer>[0])=>{process.send?.({event:'generate'});return base.analyzeCustomer(input);};
 provider.createTurn=async()=>{process.send?.({event:'audit-request'});if(process.argv[3]==='hang-audit')return new Promise(()=>{});return {text:JSON.stringify({checks:[]}),output:[],toolCalls:[],usage:{inputTokens:1,outputTokens:1,totalTokens:2}};};
 await processAgentTask(process.argv[2],provider);await mongoose.disconnect();process.exit(0);
}
void main().catch(()=>{process.exit(1);});
