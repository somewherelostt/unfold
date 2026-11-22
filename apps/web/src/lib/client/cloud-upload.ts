/** Video bytes go directly to a private bucket, outside Vercel's request body limit. */
import {UPLOAD_LIMIT_BYTES,UPLOAD_LIMIT_LABEL} from './upload-limit';
export async function uploadCloudVideo(file:File,options:{role:'primary'|'supporting'|'reference';projectId?:string;description?:string;signal?:AbortSignal;progress?:(fraction:number)=>void}):Promise<{videoId:string;projectId:string}>{
  options.signal?.throwIfAborted();
  if(file.size>UPLOAD_LIMIT_BYTES)throw new Error('Choose a video smaller than '+UPLOAD_LIMIT_LABEL+'.');
  async function call(body:unknown){
    const response=await fetch('/api/uploads',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:options.signal});
    const result=await response.json();if(!response.ok)throw new Error(result.error??'The upload could not be completed.');return result;
  }
  const grant=await call({action:'begin',filename:file.name,bytes:file.size,role:options.role,projectId:options.projectId,description:options.description});
  const {Upload}=await import('tus-js-client');
  options.signal?.throwIfAborted();
  await new Promise<void>((resolve,reject)=>{
    let settled=false;
    const cleanup=()=>options.signal?.removeEventListener('abort',abort);
    const finish=(error?:Error)=>{if(settled)return;settled=true;cleanup();if(error)reject(error);else resolve();};
    const upload=new Upload(file,{
      endpoint:grant.endpoint,headers:{'x-signature':grant.token,'x-upsert':'false',apikey:process.env.NEXT_PUBLIC_UNFOLD_AUTH_ANON_KEY??''},
      metadata:{bucketName:grant.bucket,objectName:grant.objectKey,contentType:grant.contentType,cacheControl:'0'},
      chunkSize:6*1024*1024,retryDelays:[0,1000,3000,5000],uploadDataDuringCreation:true,
      storeFingerprintForResuming:false,removeFingerprintOnSuccess:true,
      onProgress:(sent,total)=>options.progress?.(total?sent/total:0),
      onError:()=>finish(new Error('The video upload lost its connection. Choose the file again to retry.')),
      onSuccess:()=>finish(),
    });
    const abort=()=>{void upload.abort().finally(()=>finish(new DOMException('Upload cancelled','AbortError')));};
    options.signal?.addEventListener('abort',abort,{once:true});
    if(options.signal?.aborted)abort();else upload.start();
  });
  options.signal?.throwIfAborted();
  return call({action:'complete',videoId:grant.videoId});
}
