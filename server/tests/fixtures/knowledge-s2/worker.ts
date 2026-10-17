// Test-only process: refuses every database except the disposable S2 memory fixture.
import mongoose from 'mongoose';
process.env.NODE_ENV='test';process.env.KNOWLEDGE_RETRIEVAL_MODE='semantic';
async function main(){
 const uri=process.env.MONGODB_URI??'';
 if(!/^mongodb:\/\/127\.0\.0\.1:\d+\/s2_isolated_fictional(?:\?|$)/.test(uri))throw new Error('Refusing non-fixture database');
 await mongoose.connect(uri);
 const {processKnowledgeIndex}=await import('../../../src/services/knowledge/index.service');
 await processKnowledgeIndex(process.argv[2]);await mongoose.disconnect();
}
void main().catch(()=>process.exit(1));
