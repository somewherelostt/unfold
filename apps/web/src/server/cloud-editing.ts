import path from 'node:path';
import {randomUUID} from 'node:crypto';
/** Executes inside the long-lived media/AI worker, never inside a Vercel HTTP request. */
import {generateVariants,remixPlan,analyzeStyle} from '@unfold/agent';
import {AgentServiceError,type AgentErrorCode} from '@unfold/agent';
import type {z} from 'zod';
import {createExecution} from '../lib/auth/execution';
import {storage,store,getAnalysis,getLibrary,resolveSupporting,frameLoader,type GenerationRequest} from './store';
import {StorageError,type Owner} from './private-storage';
import {GenerationInput,RemixInput,ReferenceInput} from './cloud-tasks';
import {variantErrorPayload} from './agent-errors';
import {validateSavedEdit} from './plan-access';
type Send=(type:string,data:unknown)=>Promise<unknown>;
export type Commit = <T>(work:()=>Promise<T>)=>Promise<T>;
export async function runGeneration(owner:Owner,input:z.infer<typeof GenerationInput>,signal:AbortSignal,send:Send,commit:Commit){
 const primary=await storage.getAsset(owner,input.videoId),analysis=await getAnalysis(owner,input.videoId);
 if(primary.role!=='primary'||!analysis)throw new StorageError(409,'Analyze this video first.');
 const supporting=await resolveSupporting(owner,primary.projectId,input.supportingAssetIds),style=input.styleId?await store.getStyle(owner,input.styleId):null;
 if(style&&style.projectId!==primary.projectId)throw new StorageError(404,'Not found.');
 const library=await getLibrary(),startedAt=Date.now(),execution=await createExecution({id:owner.id,email:null},signal);
 let ok=0,tokens=0,tps=0,lastCode:AgentErrorCode|undefined;
 try{
  await send('start',{count:input.count,startedAt,executionMode:execution.mode});
  for await(const variant of generateVariants({analysis,library,supporting,loadFrame:frameLoader(owner,primary.projectId),config:execution.config},input.prompt,{count:input.count,style:style?.profile,aspect:input.aspect,signal})){
   signal.throwIfAborted();
   if(!variant.result){lastCode=variant.errorCode;await send('variant-error',{index:variant.index,...variantErrorPayload(variant.errorCode,signal)});continue;}
   const generationRequest:GenerationRequest={version:1,receivedBrief:input.prompt,requestedAspect:input.aspect,supportingAssetIds:input.supportingAssetIds,styleId:input.styleId,direction:variant.direction,createdAt:startedAt};
   const result=variant.result;
   const stored=await commit(()=>store.putPlan(owner,primary.projectId,{editPlan:result.editPlan,agentPlan:result.agentPlan,videoId:analysis.videoId,createdAt:Date.now(),generationRequest}));
   ok++;tokens+=variant.result.stats.outputTokens;tps+=variant.result.stats.tps;
   await send('variant',{index:variant.index,direction:variant.direction,editPlan:stored.editPlan,agentPlan:stored.agentPlan,stats:variant.result.stats,projectId:primary.projectId,revision:stored.revision,updatedAt:stored.updatedAt,generationRequest});
  }
  await send('summary',{count:input.count,ok,wallMs:Date.now()-startedAt,outputTokens:tokens,avgTps:ok?Math.round(tps/ok):0});
  if(!ok)throw new AgentServiceError(lastCode??'INVALID_RESPONSE');
 }finally{await execution.dispose();}
}
export async function runRemix(owner:Owner,input:z.infer<typeof RemixInput>,signal:AbortSignal,send:Send,commit:Commit){
 const saved=await store.getPlan(owner,input.planId),currentEdit=await validateSavedEdit(owner,saved,input.editPlan??saved.editPlan),analysis=await getAnalysis(owner,saved.videoId);
 if(!analysis)throw new StorageError(409,'Source analysis is unavailable.');
 const supporting=await resolveSupporting(owner,saved.projectId,(currentEdit.supporting??[]).map(a=>a.videoId)),library=await getLibrary(),execution=await createExecution({id:owner.id,email:null},signal);
 try{
  const result=await remixPlan({analysis,library,supporting,config:execution.config,loadFrame:frameLoader(owner,saved.projectId)},saved.agentPlan,input.message,{signal,currentEdit});
  signal.throwIfAborted();
  const stored=await commit(()=>store.putPlan(owner,saved.projectId,{editPlan:result.editPlan,agentPlan:result.agentPlan,videoId:saved.videoId,createdAt:Date.now()}));
  await send('plan',{editPlan:stored.editPlan,agentPlan:stored.agentPlan,stats:result.stats,revision:stored.revision,updatedAt:stored.updatedAt,projectId:stored.projectId});
 }finally{await execution.dispose();}
}

export async function runReference(owner:Owner,input:z.infer<typeof ReferenceInput>,signal:AbortSignal,send:Send,commit:Commit){
 const execution=await createExecution({id:owner.id,email:null},signal);
 try{
  const project=await storage.getProject(owner,input.primaryVideoId);
  const videoId=input.assetId??'s_'+randomUUID().replaceAll('-','');
  if(!input.assetId)await storage.addAsset(owner,project.id,{assetId:videoId,videoId,projectId:project.id,primaryVideoId:project.id,role:'reference',description:'',filename:'Reference video',extension:'.mp4',status:'uploaded',createdAt:Date.now()});
  const options={videoId,mediaDir:path.join(storage.projectDir(project.id),'media'),urlPrefix:'/media/'+project.id,skipProxy:true,maxFrames:8,signal,maxDurationSec:180,reuseExisting:true};
  const media=await import('@unfold/media');
  const reference=input.assetId?await media.analyzeReferenceFile((await storage.assetPaths(owner,videoId)).upload,options):await media.fetchReference(input.url!,options);
  signal.throwIfAborted();await storage.updateAsset(owner,project.id,videoId,{status:'analyzed'});
  const {profile,stats}=await analyzeStyle(reference.analysis,frameLoader(owner,project.id),{cutsPerMinute:reference.stats.cutsPerMinute,avgShotSec:reference.stats.avgShotSec},execution.config);
  signal.throwIfAborted();await commit(()=>store.putStyle(owner,project.id,videoId,{profile,sourceUrl:input.url??null}));
  await send('reference',{styleId:videoId,profile,cutStats:reference.stats,title:reference.title??'Reference video',stats,projectId:project.id});
 }finally{await execution.dispose();}
}
