import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { openAsBlob, createReadStream } from 'node:fs';
import { mkdir, rename, rm, stat } from 'node:fs/promises';
import { randomUUID, createHash } from 'node:crypto';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

export class CloudMediaError extends Error {
  constructor(readonly code: string, readonly status = 503) { super('Cloud media is unavailable. Try again shortly.'); this.name = 'CloudMediaError'; }
}
export type BlobInfo = { bytes: number; mime: string; version?: string };
export interface BlobRepository {
  readonly bucket: string;
  info(key: string): Promise<BlobInfo>;
  signedUpload(key: string): Promise<{ token: string; endpoint: string }>;
  signedRead(key: string, seconds: number): Promise<string>;
  upload(key: string, file: string, mime: string): Promise<void>;
  download(key: string, target: string, expectedBytes?: number, expectedHash?: string): Promise<void>;
  bytes(key: string): Promise<Uint8Array>;
  remove(keys: string[]): Promise<void>;
  removePrefix?(prefix: string): Promise<void>;
}
const safeKey = (key: string) => {
  if (!key || key.length > 800 || key.split('/').some(p => !/^[a-zA-Z0-9_.-]+$/.test(p) || p === '.' || p === '..')) throw new CloudMediaError('INVALID_KEY',400);
  return key;
};
export async function fileSha256(file: string) { const hash=createHash('sha256');for await(const chunk of createReadStream(file))hash.update(chunk);return hash.digest('hex'); }
export class SupabaseBlobs implements BlobRepository {
  readonly bucket: string;
  private client: SupabaseClient;
  private origin: string;
  private serverKey: string;
  constructor(env: NodeJS.ProcessEnv = process.env) {
    this.bucket = env.UNFOLD_STORAGE_BUCKET ?? 'unfold-private';
    this.origin = env.NEXT_PUBLIC_UNFOLD_AUTH_URL ?? '';
    this.serverKey = env.UNFOLD_AUTH_SERVICE_KEY ?? '';
    if (!this.origin || !this.serverKey) throw new CloudMediaError('CONFIG');
    const url = new URL(this.origin);
    if (url.protocol !== 'https:' && !['127.0.0.1','localhost'].includes(url.hostname)) throw new CloudMediaError('CONFIG');
    this.client=createClient(this.origin,this.serverKey,{auth:{persistSession:false,autoRefreshToken:false}});
  }
  async info(key: string): Promise<BlobInfo> {
    const {data,error}=await this.client.storage.from(this.bucket).info(safeKey(key));
    if(error||!data)throw new CloudMediaError('OBJECT_UNAVAILABLE',404);
    const bytes=Number(data.size); if(!Number.isSafeInteger(bytes)||bytes<0)throw new CloudMediaError('INVALID_OBJECT',409);
    return {bytes,mime:data.contentType??'application/octet-stream',version:data.etag};
  }
  async signedUpload(key: string) {
    const {data,error}=await this.client.storage.from(this.bucket).createSignedUploadUrl(safeKey(key),{upsert:false});
    if(error||!data?.token)throw new CloudMediaError('UPLOAD_UNAVAILABLE');
    const host=new URL(this.origin);
    if(host.hostname.endsWith('.supabase.co'))host.hostname=host.hostname.replace('.supabase.co','.storage.supabase.co');
    return {token:data.token,endpoint:new URL('/storage/v1/upload/resumable/sign',host).href};
  }
  async signedRead(key: string,seconds:number) {
    if(!Number.isInteger(seconds)||seconds<1||seconds>1800)throw new CloudMediaError('INVALID_LIFETIME',400);
    const {data,error}=await this.client.storage.from(this.bucket).createSignedUrl(safeKey(key),seconds);
    if(error||!data?.signedUrl)throw new CloudMediaError('OBJECT_UNAVAILABLE',404);
    return data.signedUrl;
  }
  async upload(key:string,file:string,mime:string) {
    const data=await openAsBlob(file,{type:mime});
    const {error}=await this.client.storage.from(this.bucket).upload(safeKey(key),data,{contentType:mime,upsert:false});
    if(error)throw new CloudMediaError('UPLOAD_FAILED');
  }
  private async response(key:string) {
    const encoded=safeKey(key).split('/').map(encodeURIComponent).join('/');
    const url=new URL('/storage/v1/object/authenticated/'+encodeURIComponent(this.bucket)+'/'+encoded,this.origin);
    let response:Response;
    try {response=await fetch(url,{headers:{Authorization:'Bearer '+this.serverKey,apikey:this.serverKey},redirect:'error',signal:AbortSignal.timeout(120000),cache:'no-store'});}
    catch {throw new CloudMediaError('DOWNLOAD_FAILED');}
    if(!response.ok||!response.body){await response.body?.cancel();throw new CloudMediaError('OBJECT_UNAVAILABLE',response.status===404?404:503);}
    return response;
  }
  async bytes(key:string) {
    const response=await this.response(key);
    const length=Number(response.headers.get('content-length')??0);
    if(length>8*1024*1024){await response.body?.cancel();throw new CloudMediaError('OBJECT_TOO_LARGE',413);}
    const reader=response.body!.getReader(),chunks:Uint8Array[]=[];let bytes=0;
    try{for(;;){const item=await reader.read();if(item.done)break;bytes+=item.value.length;if(bytes>8*1024*1024){await reader.cancel();throw new CloudMediaError('OBJECT_TOO_LARGE',413);}chunks.push(item.value);}}
    finally{reader.releaseLock();}
    const result=new Uint8Array(bytes);let offset=0;for(const chunk of chunks){result.set(chunk,offset);offset+=chunk.length;}return result;
  }
  async download(key:string,target:string,expectedBytes?:number,expectedHash?:string) {
    try{const local=await stat(target);if(local.isFile()&&local.size===expectedBytes&&expectedHash&&await fileSha256(target)===expectedHash)return;}catch{}
    await mkdir(path.dirname(target),{recursive:true,mode:0o700});
    const temporary=target+'.'+randomUUID()+'.part';
    try{
      const response=await this.response(key);
      const {createWriteStream}=await import('node:fs');
      await pipeline(Readable.fromWeb(response.body! as never),createWriteStream(temporary,{flags:'wx',mode:0o600}));
      const actual=await stat(temporary);
      if((expectedBytes!==undefined&&actual.size!==expectedBytes)||(expectedHash&&await fileSha256(temporary)!==expectedHash))throw new CloudMediaError('OBJECT_CHANGED',409);
      await rename(temporary,target);
    }finally{await rm(temporary,{force:true});}
  }
  async remove(keys:string[]) {
    for(let offset=0;offset<keys.length;offset+=100){const {error}=await this.client.storage.from(this.bucket).remove(keys.slice(offset,offset+100).map(safeKey));if(error)throw new CloudMediaError('DELETE_FAILED');}
  }
  async removePrefix(prefix:string){
    safeKey(prefix);
    const visit=async(folder:string,depth:number):Promise<void>=>{
      if(depth>12)throw new CloudMediaError('INVALID_KEY');
      // Restart the first page after deletion so offsets cannot skip shifting objects.
      for(;;){
        const {data,error}=await this.client.storage.from(this.bucket).list(folder,{limit:100,offset:0,sortBy:{column:'name',order:'asc'}});
        if(error)throw new CloudMediaError('DELETE_FAILED');if(!data?.length)return;
        const files:string[]=[];
        for(const item of data){const key=folder+'/'+item.name;safeKey(key);if(item.id)files.push(key);else await visit(key,depth+1);}
        if(files.length)await this.remove(files);
      }
    };
    await visit(prefix,0);
  }
}
