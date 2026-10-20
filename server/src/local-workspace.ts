// Local CRM workspace: existing database, no seeding or mail/inbox dispatch workers.
// Start through npm run dev:workspace so dynamic TypeScript imports use the same loader.
import env from './config/env';
import {connectDatabase,disconnectDatabase} from './config/db';
import {createApp} from './app';
import {semanticPool} from './services/knowledge/embedding';
async function main(){
 await connectDatabase();
 const server=createApp().listen(env.PORT,'127.0.0.1',()=>console.log('CRM workspace ready; outbound/inbox dispatch workers not started.'));
 for(const signal of ['SIGINT','SIGTERM'] as const)process.once(signal,()=>{server.close(()=>{semanticPool.close();void disconnectDatabase().then(()=>process.exit(0));});});
}
void main().catch(error=>{console.error('CRM workspace startup failed: '+error.name);process.exit(1);});
