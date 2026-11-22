import { z } from 'zod';
import { StorageError, type Owner } from './private-storage.ts';
import { SupabasePrivateStorage } from './supabase-storage.ts';

const Input=z.discriminatedUnion('action',[
 z.object({action:z.literal('begin'),filename:z.string().min(1).max(160),bytes:z.number().int().positive(),role:z.enum(['primary','supporting','reference']),projectId:z.string().min(1).max(80).optional(),description:z.string().max(500).optional()}).strict(),
 z.object({action:z.literal('complete'),videoId:z.string().min(1).max(80)}).strict(),
]);
export async function cloudUploadRequest(storage:SupabasePrivateStorage,owner:Owner,request:Request){
  if(request.headers.get('origin')!==new URL(request.url).origin)throw new StorageError(403,'Open Unfold to upload this video.');
  if(!request.headers.get('content-type')?.startsWith('application/json'))throw new StorageError(415,'Upload settings must be JSON.');
  const reader=request.body?.getReader();if(!reader)throw new StorageError(400,'Upload settings are required.');
  const chunks:Uint8Array[]=[];let size=0;
  try {for(;;){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>4096){await reader.cancel();throw new StorageError(413,'Upload settings are too large.');}chunks.push(part.value);}}
  finally{reader.releaseLock();}
  const data=Buffer.concat(chunks);let raw:unknown;try{raw=JSON.parse(data.toString('utf8'));}catch{throw new StorageError(400,'Invalid upload settings.');}
  const parsed=Input.safeParse(raw);if(!parsed.success)throw new StorageError(400,'Invalid upload settings.');
  if(parsed.data.action==='begin')return storage.beginUpload(owner,parsed.data);
  return storage.completeUpload(owner,parsed.data.videoId);
}
