import {CloudDatabase} from '@unfold/cloud';
import {type Claim,type JobKind,type JobHandler,HandlerFailure} from '@unfold/jobs';
import {storage} from './store';
import {isSupabaseStorage} from './supabase-storage';
import {GenerationInput,RemixInput,ReferenceInput,type TaskSnapshot} from './cloud-tasks';
import {agentErrorPayload} from './agent-errors';
export function cloudTaskHandlers(db:CloudDatabase):Partial<Record<JobKind,JobHandler>>{
 const handler:JobHandler=async ctx=>{
  if(!isSupabaseStorage(storage))throw new HandlerFailure('CONFIG','Cloud task storage is unavailable.');
  const owner={id:ctx.ownerId},snapshot=await storage.getJobInput<TaskSnapshot>(owner,ctx.projectId,ctx.job.input.id,ctx.job.input.revision);
  if(snapshot.kind!==ctx.job.kind||snapshot.version!==1)throw new HandlerFailure('INPUT_CHANGED','This task revision is unavailable.');
  const release=await storage.acquireLease(owner,ctx.projectId,'task-'+snapshot.kind);
  const pending:Promise<unknown>[]=[];
  // Every event rechecks the exact lease in the same queue transaction; stale workers cannot publish results.
  const send=(type:string,data:unknown)=>{const work=appendEvent(db,ctx.job,type,data);pending.push(work);return work;};
  try{
   const {runGeneration,runRemix,runReference}=await import('./cloud-editing');
   const commit=<T>(work:()=>Promise<T>)=>withFence(db,ctx.job,work);
   if(snapshot.kind==='generation')await runGeneration(owner,GenerationInput.parse(snapshot.input),ctx.signal,send,commit);
   else if(snapshot.kind==='remix')await runRemix(owner,RemixInput.parse(snapshot.input),ctx.signal,send,commit);
   else await runReference(owner,ReferenceInput.parse(snapshot.input),ctx.signal,send,commit);
   await Promise.all(pending);ctx.signal.throwIfAborted();return{output:{kind:'task',id:ctx.job.id}};
  }catch(error){await Promise.allSettled(pending);await send('error',agentErrorPayload(error,ctx.signal));throw new HandlerFailure('EDITING_FAILED','This edit could not be completed. See its saved error for details.');}
  finally{await Promise.allSettled(pending);await release();}
 };
 return{generation:handler,remix:handler,reference:handler};
}
async function appendEvent(db:CloudDatabase,claim:Claim,type:string,data:unknown){
 const value=JSON.stringify(data);if(value.length>1024*1024)throw new HandlerFailure('RESULT_TOO_LARGE','The edit result exceeded its supported size.');
 await withFence(db,claim,async()=>{
  await db.run('INSERT INTO unfold.task_events(job_id,event_type,body) VALUES (?,?,?::jsonb)',claim.id,type,value);
 });
}
async function withFence<T>(db:CloudDatabase,claim:Claim,work:()=>Promise<T>){
 return db.transaction('media-jobs',async()=>{
  const row=await db.get('SELECT body FROM unfold.jobs WHERE id=? AND owner_id=?',claim.id,claim.ownerId),job=row?JSON.parse(String(row.body)):null;
  if(!job||job.state!=='running'||job.lease?.token!==claim.lease.token||job.lease.expiresAt<=Date.now()||job.cancelRequestedAt!==null)throw new HandlerFailure('LEASE_LOST','This task is no longer active.');
  return work();
 });
}
