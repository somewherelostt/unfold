import {readFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {mkdir} from 'node:fs/promises';
import {CloudDatabase} from '@unfold/cloud';
import {CloudJobWorker,PostgresJobStore,loadJobConfig} from '../src/index.ts';
import {cleanCloudScratch} from '../src/cloud-worker.ts';
import {createApplicationHandlers} from '../../../apps/web/src/server/job-bindings.ts';
import {storage} from '../../../apps/web/src/server/store.ts';
import {isSupabaseStorage} from '../../../apps/web/src/server/supabase-storage.ts';
import {cloudTaskHandlers} from '../../../apps/web/src/server/cloud-task-handlers.ts';
import {syncLibrary} from '../../../infra/cloud/sync-library.mts';
if(process.env.UNFOLD_BACKEND!=='supabase'||process.env.UNFOLD_CLOUD_WORKER!=='1'||!isSupabaseStorage(storage))throw Error('Cloud worker requires Supabase storage.');
process.umask(0o077);
const shutdown=new AbortController();process.once('SIGTERM',()=>shutdown.abort());process.once('SIGINT',()=>shutdown.abort());
if(!process.env.UNFOLD_BROWSER_EXECUTABLE){try{process.env.UNFOLD_BROWSER_EXECUTABLE=(await readFile('/opt/unfold-browser-path','utf8')).trim();}catch{}}
const config=loadJobConfig(),db=new CloudDatabase(),queue=new PostgresJobStore(config),worker=new CloudJobWorker(queue,{handlers:{...createApplicationHandlers(config,{storage}),...cloudTaskHandlers(db)},onError:()=>console.error('A cloud job transition failed. Check the persisted job status.')});
const health=createServer((_request,response)=>{const ready=!shutdown.signal.aborted&&worker.lastHeartbeatAt>0&&Date.now()-worker.lastHeartbeatAt<30000;response.writeHead(ready?200:503,{'Content-Type':'application/json'});response.end(JSON.stringify({ready}));});
let cleaning:Promise<void>|null=null;
function clean():Promise<void>{
 if(cleaning)return cleaning;
 cleaning=(async()=>{
  try{await cleanCloudScratch(queue);}catch{console.error('Private scratch cleanup will retry.');}
  if(shutdown.signal.aborted||!isSupabaseStorage(storage)||!storage.blobs.removePrefix)return;
  try{for(const row of await storage.db.all('SELECT prefix FROM unfold.storage_deletions WHERE retain_until<=? ORDER BY created_at LIMIT 20',Date.now())){
   if(shutdown.signal.aborted)break;
   await storage.blobs.removePrefix(String(row.prefix));await storage.db.run('DELETE FROM unfold.storage_deletions WHERE prefix=?',row.prefix);
  }}catch{console.error('Private storage cleanup will retry.');}
 })().finally(()=>{cleaning=null;});
 return cleaning;
}
let retention:ReturnType<typeof setInterval>|undefined;
try{
 await mkdir(config.artifactRoot,{recursive:true,mode:0o700});
 await syncLibrary(config.repoRoot,shutdown.signal);
 if(!shutdown.signal.aborted){
  await new Promise<void>((resolve,reject)=>{health.once('error',reject);health.listen(8080,'0.0.0.0',()=>{health.removeListener('error',reject);resolve();});});
  retention=setInterval(()=>{void clean();},60000);retention.unref();
  // Queue heartbeats must not wait for a backlog of private blob deletions.
  const running=worker.run(shutdown.signal);void clean();await running;
 }
}finally{
 if(retention)clearInterval(retention);
 await worker.stop();await cleaning;
 if(health.listening)await new Promise<void>((resolve,reject)=>health.close(error=>error?reject(error):resolve()));
 await Promise.all([queue.close(),db.close(),storage.db.close()]);
}
