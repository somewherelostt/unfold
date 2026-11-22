import {readFile,mkdir,writeFile,rename,rm} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import path from 'node:path';
import {fileSha256} from '../../packages/cloud/src/blobs.ts';
export async function syncLibrary(repoRoot:string){
 const manifest=JSON.parse(await readFile(path.join(repoRoot,'infra/cloud/library-integrity.json'),'utf8')) as {version:string;files:{path:string;bytes:number;sha256:string}[]};
 const origin=new URL(process.env.UNFOLD_LIBRARY_URL??'');
 if(origin.protocol!=='https:'||origin.username||origin.password||origin.search||origin.hash||!origin.pathname.endsWith('/'+manifest.version))throw Error('Configure the versioned public audio library URL.');
 let next=0;await Promise.all(Array.from({length:3},async()=>{for(;;){const item=manifest.files[next++];if(!item)return;
  if(!/^(music|sfx)\/[a-zA-Z0-9_.-]+\.(mp3|wav|json)$/.test(item.path))throw Error('Invalid library path.');
  const target=path.join(repoRoot,'apps/web/public/assets',item.path);
  try{if(await fileSha256(target)===item.sha256)continue;}catch{}
  const response=await fetch(origin.href+'/'+item.path,{redirect:'error',signal:AbortSignal.timeout(60000)});
  if(!response.ok||!response.body)throw Error('The public audio library is unavailable.');
  const chunks:Uint8Array[]=[];let bytes=0;const reader=response.body.getReader();
  try{for(;;){const chunk=await reader.read();if(chunk.done)break;bytes+=chunk.value.length;if(bytes>item.bytes){await reader.cancel();throw Error('The audio library changed.');}chunks.push(chunk.value);}}finally{reader.releaseLock();}
  const value=Buffer.concat(chunks);if(bytes!==item.bytes||createHash('sha256').update(value).digest('hex')!==item.sha256)throw Error('The audio library could not be verified.');
  await mkdir(path.dirname(target),{recursive:true});const temp=target+'.'+randomUUID()+'.part';try{await writeFile(temp,value,{flag:'wx'});await rename(temp,target);}finally{await rm(temp,{force:true});}
 }}));
}
