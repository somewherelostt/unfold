import {createServer} from 'node:http';
import {createPublishingRuntime} from '../../../apps/web/src/server/publishing/runtime.ts';
import {isSupabaseStorage} from '../../../apps/web/src/server/supabase-storage.ts';
import {runPublishingWorker} from '../src/worker.ts';
if(process.env.UNFOLD_BACKEND!=='supabase'||process.env.UNFOLD_CLOUD_WORKER!=='1')throw Error('Cloud publishing requires Supabase storage.');
process.umask(0o077);
const runtime=createPublishingRuntime(process.env.UNFOLD_REPO_ROOT??'/app');
const shutdown=new AbortController();process.once('SIGTERM',()=>shutdown.abort());process.once('SIGINT',()=>shutdown.abort());
const server=createServer(async(_request,response)=>{let ready=false;try{ready=!shutdown.signal.aborted&&await runtime.store.workerReady();}catch{}response.writeHead(ready?200:503,{'Content-Type':'application/json'});response.end(JSON.stringify({ready}));});
try{
 if(!runtime.config.enabled||!runtime.config.apiKey)throw Error('Complete protected publishing configuration before starting this worker.');
 await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(8080,'0.0.0.0',()=>{server.removeListener('error',reject);resolve();});});
 await runPublishingWorker(runtime.store,runtime.publisher,shutdown.signal);
}finally{
 if(server.listening)await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
 await Promise.all([runtime.store.close(),...(isSupabaseStorage(runtime.storage)?[runtime.storage.db.close()]:[])]);
}
