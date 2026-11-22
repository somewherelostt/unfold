import {createServer} from 'node:http';
import {createPublishingRuntime} from '../../../apps/web/src/server/publishing/runtime.ts';
import {runPublishingWorker} from '../src/worker.ts';
if(process.env.UNFOLD_BACKEND!=='supabase'||process.env.UNFOLD_CLOUD_WORKER!=='1')throw Error('Cloud publishing requires Supabase storage.');
const runtime=createPublishingRuntime(process.env.UNFOLD_REPO_ROOT??'/app');
if(!runtime.config.enabled||!runtime.config.apiKey)throw Error('Complete protected publishing configuration before starting this worker.');
const shutdown=new AbortController();process.once('SIGTERM',()=>shutdown.abort());process.once('SIGINT',()=>shutdown.abort());
const server=createServer(async(_request,response)=>{let ready=false;try{ready=await runtime.store.workerReady();}catch{}response.writeHead(ready?200:503,{'Content-Type':'application/json'});response.end(JSON.stringify({ready}));});server.listen(8080,'0.0.0.0');
try{await runPublishingWorker(runtime.store,runtime.publisher,shutdown.signal);}finally{server.close();await runtime.store.close();}
