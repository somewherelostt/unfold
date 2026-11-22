import {readFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {mkdir} from 'node:fs/promises';
import path from 'node:path';
import {CloudDatabase} from '@unfold/cloud';
import {CloudJobWorker,PostgresJobStore,loadJobConfig} from '../src/index.ts';
import {createApplicationHandlers} from '../../../apps/web/src/server/job-bindings.ts';
import {storage} from '../../../apps/web/src/server/store.ts';
import {isSupabaseStorage} from '../../../apps/web/src/server/supabase-storage.ts';
import {cloudTaskHandlers} from '../../../apps/web/src/server/cloud-task-handlers.ts';
import {syncLibrary} from '../../../infra/cloud/sync-library.mts';
if(process.env.UNFOLD_BACKEND!=='supabase'||process.env.UNFOLD_CLOUD_WORKER!=='1'||!isSupabaseStorage(storage))throw Error('Cloud worker requires Supabase storage.');
const shutdown=new AbortController();process.once('SIGTERM',()=>shutdown.abort());process.once('SIGINT',()=>shutdown.abort());
if(!process.env.UNFOLD_BROWSER_EXECUTABLE){try{process.env.UNFOLD_BROWSER_EXECUTABLE=(await readFile('/opt/unfold-browser-path','utf8')).trim();}catch{}}
const config=loadJobConfig(),db=new CloudDatabase(),queue=new PostgresJobStore(config),worker=new CloudJobWorker(queue,{handlers:{...createApplicationHandlers(config,{storage}),...cloudTaskHandlers(db)},onError:()=>console.error('A cloud job transition failed. Check the persisted job status.')});
await mkdir(config.artifactRoot,{recursive:true,mode:0o700});
await syncLibrary(config.repoRoot);
const health=createServer((_request,response)=>{const ready=Date.now()-worker.lastHeartbeatAt<30000;response.writeHead(ready?200:503,{'Content-Type':'application/json'});response.end(JSON.stringify({ready}));});health.listen(8080,'0.0.0.0');
let cleaning=false;
async function clean(){if(cleaning||!isSupabaseStorage(storage)||!storage.blobs.removePrefix)return;cleaning=true;
 try{for(const row of await storage.db.all('SELECT prefix FROM unfold.storage_deletions WHERE retain_until<=? ORDER BY created_at LIMIT 20',Date.now())){await storage.blobs.removePrefix(String(row.prefix));await storage.db.run('DELETE FROM unfold.storage_deletions WHERE prefix=?',row.prefix);}}
 catch{console.error('Private storage cleanup will retry.');}finally{cleaning=false;}}
const retention=setInterval(()=>{void clean();},60000);retention.unref();
try{await clean();await worker.run(shutdown.signal);}finally{clearInterval(retention);health.close();await worker.stop();await queue.close();await db.close();await storage.db.close();}
