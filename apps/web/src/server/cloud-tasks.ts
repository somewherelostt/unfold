import {createHash} from 'node:crypto';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {z} from 'zod';
import {PostgresJobStore} from '@unfold/jobs';
import {EditPlan} from '@unfold/core';
import {storage,store,getAnalysis,resolveSupporting} from './store';
import {isSupabaseStorage} from './supabase-storage';
import {StorageError,type Owner} from './private-storage';
import {validateSavedEdit} from './plan-access';

export const GenerationInput=z.object({videoId:z.string().min(1).max(80),prompt:z.string().max(8000).default(''),styleId:z.string().max(80).optional(),aspect:z.enum(['9:16','1:1','16:9']).optional(),count:z.number().int().min(1).max(9).default(1),supportingAssetIds:z.array(z.string().max(80)).max(4).default([])}).strict();
export const RemixInput=z.object({planId:z.string().min(1).max(80),message:z.string().trim().min(1).max(8000),editPlan:EditPlan.optional()}).strict();
export const ReferenceInput=z.object({primaryVideoId:z.string().min(1).max(80),assetId:z.string().max(80).optional(),url:z.url().max(2000).optional()}).strict().refine(v=>Boolean(v.assetId)!==Boolean(v.url));
export type TaskKind='generation'|'remix'|'reference';
export type TaskSnapshot={version:1;kind:TaskKind;input:unknown};
let queue:PostgresJobStore|null=null;
const tasks=()=>queue??=new PostgresJobStore({databasePath:'postgres',artifactRoot:path.join(tmpdir(),'unfold-cloud-jobs')});

export async function enqueueCloudTask(owner:Owner,kind:TaskKind,raw:unknown,idempotencyKey:string){
 if(!isSupabaseStorage(storage))throw new StorageError(404,'Not found.');
 if(typeof idempotencyKey!=='string'||!/^[a-zA-Z0-9_.:-]{8,160}$/.test(idempotencyKey))throw new StorageError(400,'A valid edit request key is required.');
 const {getStoredUserApiKey}=await import('../lib/auth/api-keys');
 let configured=false;try{configured=Boolean(await getStoredUserApiKey(owner.id,'cerebras'));}catch{throw new StorageError(503,'Your saved editing key could not be read. Check Settings and try again.');}
 if(!configured)throw new StorageError(428,'Save a Cerebras key in Settings before generating an edit.');
 let projectId:string,input:unknown;
 if(kind==='generation'){
  const v=GenerationInput.safeParse(raw);if(!v.success)throw new StorageError(400,'Invalid generation request.');
  const a=await storage.getAsset(owner,v.data.videoId);if(a.role!=='primary'||!await getAnalysis(owner,a.assetId))throw new StorageError(409,'Analyze this video first.');
  projectId=a.projectId;await resolveSupporting(owner,projectId,v.data.supportingAssetIds);
  if(v.data.styleId&&(await store.getStyle(owner,v.data.styleId)).projectId!==projectId)throw new StorageError(404,'Not found.');input=v.data;
 }else if(kind==='remix'){
  const v=RemixInput.safeParse(raw);if(!v.success)throw new StorageError(400,'Invalid edit request.');
  const saved=await store.getPlan(owner,v.data.planId);projectId=saved.projectId;
  input={...v.data,editPlan:await validateSavedEdit(owner,saved,v.data.editPlan??saved.editPlan)};
 }else{
  const v=ReferenceInput.safeParse(raw);if(!v.success)throw new StorageError(400,'Choose a reference video or public link.');
  projectId=v.data.primaryVideoId;await storage.getProject(owner,projectId);
  if(v.data.assetId){const asset=await storage.getAsset(owner,v.data.assetId);if(asset.role!=='reference'||asset.projectId!==projectId)throw new StorageError(404,'Not found.');}
  input=v.data;
 }
 const digest=createHash('sha256').update(JSON.stringify({owner:owner.id,projectId,idempotencyKey})).digest('hex');
 const id='task_'+digest,snapshotId='input_'+digest;
 const release=await storage.acquireLease(owner,projectId,'enqueue-task');
 try{
  const snapshot=await storage.putJobInput(owner,projectId,snapshotId,{version:1,kind,input} satisfies TaskSnapshot);
  await storage.registerReference(owner,projectId,'jobs',id);
  try{return(await tasks().enqueue({ownerId:owner.id,projectId},{kind,input:{kind:'snapshot',id:snapshot.id,revision:snapshot.revision},idempotencyKey:id},{id})).job;}
  catch(error){
   try{const prior=await tasks().getForOwner(owner.id,id);if(['succeeded','failed','cancelled'].includes(prior.job.state))await storage.unregisterJob(owner,projectId,id);}
   catch(lookup){if(lookup&&typeof lookup==='object'&&'code'in lookup&&lookup.code==='NOT_FOUND')await storage.unregisterJob(owner,projectId,id);}
   throw error;
  }
 }finally{await release();}
}
export async function cloudTaskStatus(owner:Owner,id:string,after:number){
 if(!isSupabaseStorage(storage)||!Number.isSafeInteger(after)||after<0)throw new StorageError(400,'Invalid task cursor.');
 const found=await tasks().getForOwner(owner.id,id);await storage.getProject(owner,found.context.projectId);
 if(!['generation','remix','reference'].includes(found.job.kind))throw new StorageError(404,'Not found.');
 const events=await storage.db.all('SELECT id,event_type,body FROM unfold.task_events WHERE job_id=? AND id>? ORDER BY id LIMIT 50',id,after);
 if(['succeeded','failed','cancelled'].includes(found.job.state))await storage.unregisterJob(owner,found.context.projectId,id);
 return{job:found.job,events:events.map(e=>({cursor:Number(e.id),type:String(e.event_type),...e.body as Record<string,unknown>}))};
}
