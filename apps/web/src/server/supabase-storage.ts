import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { CloudDatabase, SupabaseBlobs, fileSha256, type BlobRepository } from '@unfold/cloud';
import { PrivateStorage, StorageError, RevisionConflict, validId, type Owner, type PrivateAsset, type Project } from './private-storage.ts';

export type CloudMediaEntry = {
  project_id:string; relative_path:string; owner_id:string; object_key:string;
  sha256:string; bytes:string|number; mime:string; properties:Record<string,unknown>|null;
  completed:boolean; created_at:string|number;
};
const missing=()=>new StorageError(404,'Not found.');
const copy=<T>(v:T):T=>structuredClone(v);
const assertId=(value:string)=>{if(typeof value!=='string'||!validId(value))throw missing();return value;};
const assertOwner=(owner:Owner)=>{if(!owner||!/^[-a-zA-Z0-9_.@]{1,160}$/.test(owner.id))throw missing();return owner.id;};
const safeRelative=(value:string)=>{if(value.length>600||value.split('/').some(p=>!/^[-a-zA-Z0-9_.]+$/.test(p)||p==='.'||p==='..'))throw missing();return value;};
const mime=(file:string)=>({'.mp4':'video/mp4','.mov':'video/quicktime','.m4v':'video/mp4','.mkv':'video/x-matroska','.webm':'video/webm','.json':'application/json','.jpg':'image/jpeg','.jpeg':'image/jpeg','.png':'image/png','.wav':'audio/wav','.mp3':'audio/mpeg'}[path.extname(file)]??'application/octet-stream');

/** Supabase is authoritative. Local paths are worker scratch/cache, never ownership or queue state. */
export class SupabasePrivateStorage extends PrivateStorage {
  readonly cloud=true;
  readonly db:CloudDatabase;
  readonly blobs:BlobRepository;
  constructor(root:string, options:{db?:CloudDatabase;blobs?:BlobRepository}={}) {
    super(root);this.db=options.db??new CloudDatabase();this.blobs=options.blobs??new SupabaseBlobs();
  }
  private async remoteProject(owner:Owner,projectId:string,includeDeleting=false):Promise<Project> {
    const row=await this.db.get('SELECT body FROM unfold.projects WHERE id=? AND owner_id=?',assertId(projectId),assertOwner(owner));
    const p=row?.body as Project|undefined;
    if(!p||p.ownerId!==owner.id||(!includeDeleting&&p.state!=='active'))throw missing();return copy(p);
  }
  private async mutateRemote<T>(owner:Owner,projectId:string,work:(project:Project)=>Promise<T>|T):Promise<T> {
    return this.db.transaction('project:'+assertId(projectId),async()=>{
      const p=await this.remoteProject(owner,projectId);const result=await work(p);p.updatedAt=Date.now();
      await this.db.run('UPDATE unfold.projects SET body=?::jsonb,revision=revision+1,updated_at=? WHERE id=? AND owner_id=?',JSON.stringify(p),p.updatedAt,p.id,owner.id);
      return result;
    });
  }
  override getProject(owner:Owner,projectId:string){return this.remoteProject(owner,projectId);}
  override async listProjects(owner:Owner){const rows=await this.db.all("SELECT body FROM unfold.projects WHERE owner_id=? AND body->>'state'='active' ORDER BY updated_at DESC LIMIT 300",assertOwner(owner));return rows.map(r=>copy(r.body as Project));}
  override async createProject(owner:Owner,projectId:string,title:string){
    assertId(projectId);assertOwner(owner);
    return this.db.transaction('project:'+projectId,async()=>{
      if(await this.db.get('SELECT id FROM unfold.projects WHERE id=?',projectId))throw new StorageError(409,'Project already exists.');
      const now=Date.now();const p:Project={version:1,id:projectId,ownerId:owner.id,title:title.slice(0,200),createdAt:now,updatedAt:now,state:'active',assets:{},plans:[],styles:[],exports:[],jobs:[],leases:{}};
      await this.db.run('INSERT INTO unfold.projects(id,owner_id,body,updated_at) VALUES (?,?,?::jsonb,?)',projectId,owner.id,JSON.stringify(p),now);return p;
    });
  }
  override async addAsset(owner:Owner,projectId:string,asset:PrivateAsset){return this.mutateRemote(owner,projectId,async p=>{
    if(asset.projectId!==p.id||asset.primaryVideoId!==p.id||asset.videoId!==asset.assetId||!/^\.[a-z0-9]{1,8}$/.test(asset.extension))throw new StorageError(400,'Invalid media association.');
    assertId(asset.assetId);if(p.assets[asset.assetId])throw new StorageError(409,'Asset already exists.');
    if(asset.role==='supporting'&&Object.values(p.assets).filter(a=>a.role==='supporting').length>=4)throw new StorageError(409,'Remove an unused supporting video before adding another.');
    await this.db.run("INSERT INTO unfold.refs(kind,id,project_id,owner_id) VALUES ('assets',?,?,?)",asset.assetId,p.id,owner.id);p.assets[asset.assetId]=asset;return copy(asset);
  });}
  override async getAsset(owner:Owner,assetId:string):Promise<PrivateAsset>{
    const ref=await this.db.get("SELECT project_id FROM unfold.refs WHERE kind='assets' AND id=? AND owner_id=?",assertId(assetId),assertOwner(owner));if(!ref)throw missing();
    const p=await this.getProject(owner,String(ref.project_id));const asset=p.assets[assetId];if(!asset)throw missing();
    const intent=await this.db.get('SELECT completed_at FROM unfold.upload_intents WHERE asset_id=? AND owner_id=?',assetId,owner.id);
    if(intent&&!intent.completed_at)throw new StorageError(409,'Finish uploading this video before using it.');return copy(asset);
  }
  async beginUpload(owner:Owner,input:{filename:string;bytes:number;role:'primary'|'supporting'|'reference';projectId?:string;description?:string}){
    const extension=path.extname(input.filename).toLowerCase(),max=Math.min(500*1024*1024,Number(process.env.UNFOLD_MAX_UPLOAD_BYTES??50*1024*1024));
    if(!['.mp4','.mov','.m4v','.webm','.mkv'].includes(extension)||!Number.isSafeInteger(input.bytes)||input.bytes<1||input.bytes>max)throw new StorageError(400,'Choose a supported video within the upload size limit.');
    const assetId='v_'+randomUUID().replaceAll('-',''),projectId=input.role==='primary'?assetId:assertId(input.projectId??'');
    if(input.role==='primary')await this.createProject(owner,projectId,input.filename);else await this.getProject(owner,projectId);
    const asset:PrivateAsset={assetId,videoId:assetId,projectId,primaryVideoId:projectId,role:input.role,description:(input.description??'').slice(0,500),filename:input.filename.slice(0,160),extension,status:'uploaded',createdAt:Date.now()};
    const key=assertOwner(owner)+'/'+projectId+'/uploads/'+assetId+extension;
    await this.db.transaction('project:'+projectId,async()=>{await this.addAsset(owner,projectId,asset);await this.db.run('INSERT INTO unfold.upload_intents(asset_id,project_id,owner_id,object_key,expected_bytes,mime,expires_at) VALUES (?,?,?,?,?,?,?)',assetId,projectId,owner.id,key,input.bytes,mime('file'+extension),Date.now()+2*3600000);});
    const grant=await this.blobs.signedUpload(key);
    return {videoId:assetId,assetId,projectId,primaryVideoId:projectId,bucket:this.blobs.bucket,objectKey:key,contentType:mime('file'+extension),...grant};
  }
  async completeUpload(owner:Owner,assetId:string){
    const row=await this.db.get('SELECT * FROM unfold.upload_intents WHERE asset_id=? AND owner_id=?',assertId(assetId),assertOwner(owner));if(!row)throw missing();
    const p=await this.getProject(owner,String(row.project_id));if(!p.assets[assetId])throw missing();
    if(Number(row.expires_at)<Date.now()&&!row.completed_at)throw new StorageError(409,'This upload expired. Choose the file again.');
    const info=await this.blobs.info(String(row.object_key));if(info.bytes!==Number(row.expected_bytes))throw new StorageError(409,'The uploaded video is incomplete. Retry this upload.');
    await this.db.transaction('project:'+p.id,async()=>{
      await this.getProject(owner,p.id);
      await this.db.run("INSERT INTO unfold.media_files(project_id,relative_path,owner_id,object_key,sha256,bytes,mime,completed,created_at) VALUES (?,?,?,?,?,?,?,true,?) ON CONFLICT(project_id,relative_path) DO NOTHING",p.id,'uploads/'+assetId+p.assets[assetId].extension,owner.id,row.object_key,'0'.repeat(64),info.bytes,info.mime,Date.now());
      await this.db.run('UPDATE unfold.upload_intents SET completed_at=? WHERE asset_id=? AND owner_id=?',Date.now(),assetId,owner.id);
    });
    return {videoId:assetId,assetId,projectId:p.id,primaryVideoId:p.id,status:'uploaded' as const,asset:p.assets[assetId]};
  }
  private async record(owner:Owner,kind:string,resourceId:string){const r=await this.db.get('SELECT project_id,body FROM unfold.records WHERE kind=? AND id=? AND owner_id=?',kind,assertId(resourceId),assertOwner(owner));if(!r)throw missing();return r;}
  override async putRecord<T>(owner:Owner,projectId:string,kind:'plans'|'styles',resourceId:string,value:T){return this.mutateRemote(owner,projectId,async p=>{
    assertId(resourceId);const prior=await this.db.get('SELECT owner_id,project_id FROM unfold.refs WHERE kind=? AND id=?',kind,resourceId);if(prior&&(prior.owner_id!==owner.id||prior.project_id!==projectId))throw missing();
    await this.db.run('INSERT INTO unfold.records(kind,id,project_id,owner_id,body) VALUES (?,?,?,?,?::jsonb) ON CONFLICT(kind,id) DO UPDATE SET body=excluded.body',kind,resourceId,p.id,owner.id,JSON.stringify(value));
    await this.db.run('INSERT INTO unfold.refs(kind,id,project_id,owner_id) VALUES (?,?,?,?) ON CONFLICT(kind,id) DO NOTHING',kind,resourceId,p.id,owner.id);
    if(!p[kind].includes(resourceId))p[kind].push(resourceId);return value;
  });}
  override async getRecord<T>(owner:Owner,kind:'plans'|'styles',resourceId:string){const r=await this.record(owner,kind,resourceId);const p=await this.getProject(owner,String(r.project_id));if(!p[kind].includes(resourceId))throw missing();return {project:p,value:copy(r.body as T)};}
  override async reviseRecord<T extends {revision:number;updatedAt:number}>(owner:Owner,projectId:string,resourceId:string,revision:number,change:(current:T)=>Promise<T>){return this.mutateRemote(owner,projectId,async p=>{
    if(!p.plans.includes(resourceId))throw missing();const r=await this.record(owner,'plans',resourceId),current=r.body as T;if(current.revision!==revision)throw new RevisionConflict(current.revision);
    const updated={...await change(copy(current)),revision:revision+1,updatedAt:Date.now()};await this.db.run("UPDATE unfold.records SET body=?::jsonb WHERE kind='plans' AND id=? AND owner_id=?",JSON.stringify(updated),resourceId,owner.id);return updated;
  });}
  override async putJobInput<T>(owner:Owner,projectId:string,snapshotId:string,value:T){return this.mutateRemote(owner,projectId,async()=>{
    assertId(snapshotId);const revision=createHash('sha256').update(JSON.stringify(value)).digest('hex');const prior=await this.db.get("SELECT body FROM unfold.records WHERE kind='job-inputs' AND id=? AND owner_id=?",snapshotId,owner.id);
    if(prior&&(prior.body as {revision:string}).revision!==revision)throw new StorageError(409,'Job snapshots are immutable.');
    if(!prior)await this.db.run("INSERT INTO unfold.records(kind,id,project_id,owner_id,body) VALUES ('job-inputs',?,?,?,?::jsonb)",snapshotId,projectId,owner.id,JSON.stringify({value,revision}));return {id:snapshotId,revision};
  });}
  override async getJobInput<T>(owner:Owner,projectId:string,snapshotId:string,revision?:string):Promise<T>{await this.getProject(owner,projectId);const r=await this.record(owner,'job-inputs',snapshotId);if(r.project_id!==projectId)throw missing();const v=r.body as {value:T;revision:string};if((revision&&v.revision!==revision)||createHash('sha256').update(JSON.stringify(v.value)).digest('hex')!==v.revision)throw new StorageError(409,'Job snapshot revision changed.');return copy(v.value);}
  override async deleteJobInput(owner:Owner,projectId:string,snapshotId:string){await this.mutateRemote(owner,projectId,async p=>{if(p.jobs.length)throw new StorageError(409,'Release project jobs before removing snapshots.');await this.db.run("DELETE FROM unfold.records WHERE kind='job-inputs' AND id=? AND owner_id=?",assertId(snapshotId),owner.id);});}
  override async unregisterJob(owner:Owner,projectId:string,jobId:string){await this.mutateRemote(owner,projectId,p=>{p.jobs=p.jobs.filter(id=>id!==jobId);});}
  override async registerReference(owner:Owner,projectId:string,kind:'exports'|'jobs',resourceId:string){
    if(kind==='jobs')assertId(resourceId);else{if(!/^(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+\.(mp4|json|png|jpg)$/.test(resourceId))throw new StorageError(400,'Invalid export reference.');await this.publishFile(owner,projectId,'media/exports/'+resourceId,false);}
    await this.mutateRemote(owner,projectId,p=>{if(!p[kind].includes(resourceId))p[kind].push(resourceId);});
  }
  private async fileEntry(owner:Owner,projectId:string,relative:string):Promise<CloudMediaEntry>{await this.getProject(owner,projectId);const r=await this.db.get('SELECT * FROM unfold.media_files WHERE project_id=? AND relative_path=? AND owner_id=?',projectId,safeRelative(relative),owner.id);if(!r)throw missing();return r as CloudMediaEntry;}
  async entryForMedia(owner:Owner,parts:string[],internal=false){
    if(parts.length<3||parts.some(p=>!/^[-a-zA-Z0-9_.]+$/.test(p)||p==='.'||p==='..'))throw missing();
    const [projectId,resourceId,...rest]=parts,p=await this.getProject(owner,projectId);
    if(resourceId==='exports'){if(!p.exports.includes(rest.join('/')))throw missing();}else if(!p.assets[resourceId])throw missing();
    const r=await this.fileEntry(owner,projectId,'media/'+resourceId+'/'+rest.join('/'));if(!internal&&!r.completed)throw missing();return r;
  }
  async mediaBytes(owner:Owner,parts:string[]){return this.blobs.bytes((await this.entryForMedia(owner,parts)).object_key);}
  async signedMedia(owner:Owner,parts:string[],seconds=600){return this.blobs.signedRead((await this.entryForMedia(owner,parts)).object_key,seconds);}
  async recordExportProperties(owner:Owner,projectId:string,fileKey:string,hash:string,properties:Record<string,unknown>){
    if(process.env.UNFOLD_CLOUD_WORKER!=='1')throw new StorageError(503,'Export inspection must run on a media worker.');
    await this.getProject(owner,projectId);
    const result=await this.db.run('UPDATE unfold.media_files SET properties=?::jsonb WHERE project_id=? AND owner_id=? AND relative_path=? AND sha256=?',JSON.stringify(properties),projectId,owner.id,'media/exports/'+safeRelative(fileKey),hash);
    if(result.changes!==1)throw new StorageError(409,'This export changed during inspection.');
  }
  private async materialize(owner:Owner,projectId:string,relative:string){
    if(process.env.UNFOLD_CLOUD_WORKER!=='1')throw new StorageError(503,'This operation must run on a media worker.');
    const r=await this.fileEntry(owner,projectId,relative),target=path.join(this.projectDir(projectId),safeRelative(relative));
    await this.blobs.download(r.object_key,target,Number(r.bytes),/^0+$/.test(r.sha256)?undefined:r.sha256);
    if(/^0+$/.test(r.sha256)){const hash=await fileSha256(target);await this.db.run("UPDATE unfold.media_files SET sha256=? WHERE project_id=? AND relative_path=? AND sha256=?",hash,projectId,relative,r.sha256);}
    return target;
  }
  override async mediaPath(owner:Owner,parts:string[]){const r=await this.entryForMedia(owner,parts,true);return this.materialize(owner,r.project_id,r.relative_path);}
  override async assetPaths(owner:Owner,assetId:string){
    const asset=await this.getAsset(owner,assetId),base=this.projectDir(asset.projectId),upload=path.join(base,'uploads',assetId+asset.extension),mediaDir=path.join(base,'media');
    if(process.env.UNFOLD_CLOUD_WORKER==='1'){
      await this.materialize(owner,asset.projectId,'uploads/'+assetId+asset.extension);await mkdir(mediaDir,{recursive:true,mode:0o700});
      const rows=await this.db.all('SELECT relative_path FROM unfold.media_files WHERE project_id=? AND owner_id=? AND starts_with(relative_path,?)',asset.projectId,owner.id,'media/'+assetId+'/');
      for(const row of rows)await this.materialize(owner,asset.projectId,String(row.relative_path));
    }
    return {asset,upload,mediaDir,urlPrefix:'/media/'+asset.projectId};
  }
  async analysis<T>(owner:Owner,assetId:string):Promise<T|null>{const a=await this.getAsset(owner,assetId);if(a.status!=='analyzed')return null;const r=await this.db.get("SELECT body FROM unfold.records WHERE kind='analysis' AND id=? AND owner_id=?",assetId,owner.id);return r?copy(r.body as T):null;}
  async publishFile(owner:Owner,projectId:string,relative:string,completed:boolean,properties:Record<string,unknown>|null=null){
    safeRelative(relative);await this.getProject(owner,projectId);const file=path.join(this.projectDir(projectId),relative),info=await stat(file);if(!info.isFile()||info.size<1)throw new StorageError(409,'A media result is incomplete.');
    const hash=await fileSha256(file),prior=await this.db.get('SELECT * FROM unfold.media_files WHERE project_id=? AND relative_path=? AND owner_id=?',projectId,relative,owner.id);
    if(prior?.sha256===hash)return;
    if(prior&&relative.startsWith('media/exports/'))throw new StorageError(409,'Completed exports cannot be overwritten.');
    const key=assertOwner(owner)+'/'+projectId+'/'+path.posix.dirname(relative)+'/'+hash+'/'+path.posix.basename(relative);
    await this.blobs.upload(key,file,mime(file));
    await this.db.transaction('project:'+projectId,async()=>{await this.getProject(owner,projectId);await this.db.run('INSERT INTO unfold.media_files(project_id,relative_path,owner_id,object_key,sha256,bytes,mime,properties,completed,created_at) VALUES (?,?,?,?,?,?,?,?::jsonb,?,?) ON CONFLICT(project_id,relative_path) DO UPDATE SET object_key=excluded.object_key,sha256=excluded.sha256,bytes=excluded.bytes,mime=excluded.mime,properties=excluded.properties,completed=excluded.completed',projectId,relative,owner.id,key,hash,info.size,mime(file),JSON.stringify(properties),completed,Date.now());});
  }
  override async updateAsset(owner:Owner,projectId:string,assetId:string,change:{description?:string;status?:PrivateAsset['status']}){
    if(change.status==='analyzed'){
      if(process.env.UNFOLD_CLOUD_WORKER!=='1')throw new StorageError(503,'Analysis must complete on a media worker.');
      const folder=path.join(this.projectDir(projectId),'media',assertId(assetId));
      const visit=async(dir:string):Promise<void>=>{for(const entry of await readdir(dir,{withFileTypes:true})){const file=path.join(dir,entry.name);if(entry.isSymbolicLink())throw new StorageError(409,'Unsupported media result.');if(entry.isDirectory())await visit(file);else if(entry.isFile())await this.publishFile(owner,projectId,path.relative(this.projectDir(projectId),file),true);}};
      await visit(folder);const analysis=JSON.parse(await readFile(path.join(folder,'analysis.json'),'utf8'));
      if(analysis.videoId!==assetId||!String(analysis.src).startsWith('/media/'+projectId+'/'+assetId+'/'))throw new StorageError(409,'Invalid source analysis.');
      await this.db.run("INSERT INTO unfold.records(kind,id,project_id,owner_id,body) VALUES ('analysis',?,?,?,?::jsonb) ON CONFLICT(kind,id) DO UPDATE SET body=excluded.body",assetId,projectId,owner.id,JSON.stringify(analysis));
    }
    return this.mutateRemote(owner,projectId,p=>{const a=p.assets[assertId(assetId)];if(!a)throw missing();if(change.description!==undefined)a.description=change.description.slice(0,500);if(change.status)a.status=change.status;return copy(a);});
  }
  override async acquireLease(owner:Owner,projectId:string,purpose:string){
    const leaseId=randomUUID();const refresh=()=>this.mutateRemote(owner,projectId,p=>{p.leases[leaseId]={...p.leases[leaseId],purpose,pid:0,expiresAt:Date.now()+120000};});await refresh();
    const timer=setInterval(()=>{void refresh().catch(()=>{});},30000);timer.unref();
    const release=async()=>{clearInterval(timer);await this.mutateRemote(owner,projectId,p=>{delete p.leases[leaseId];});};return Object.assign(release,{leaseId});
  }
  override async createRenderAccess(owner:Owner,projectId:string,paths:string[],lifetimeMs=30*60000){
    if(!(lifetimeMs>0&&lifetimeMs<=30*60000))throw new StorageError(400,'Invalid render access lifetime.');
    for(const url of paths){if(!url.startsWith('/media/'+projectId+'/')||/[?#]/.test(url))throw missing();await this.entryForMedia(owner,url.slice(7).split('/'));}
    const release=await this.acquireLease(owner,projectId,'render'),secret=randomBytes(32).toString('hex');
    try{await this.mutateRemote(owner,projectId,p=>{Object.assign(p.leases[release.leaseId],{tokenHash:createHash('sha256').update(secret).digest('hex'),paths:[...new Set(paths)],grantExpiresAt:Date.now()+lifetimeMs});});}catch(error){await release();throw error;}
    return {token:release.leaseId+'.'+secret,release};
  }
  async renderMediaEntry(parts:string[],token:string){
    if(parts.length<3||token.length>150)throw missing();const [leaseId,secret]=token.split('.');
    const row=await this.db.get("SELECT owner_id,body FROM unfold.projects WHERE id=? AND body->>'state'='active'",assertId(parts[0]));if(!row)throw missing();
    const p=row.body as Project,l=p.leases[leaseId],hash=createHash('sha256').update(secret??'').digest(),expected=Buffer.from(l?.tokenHash??'','hex');
    if(!l||l.purpose!=='render'||!l.grantExpiresAt||l.grantExpiresAt<Date.now()||l.expiresAt<Date.now()||expected.length!==hash.length||!timingSafeEqual(hash,expected)||!l.paths?.includes('/media/'+parts.join('/')))throw missing();
    return this.entryForMedia({id:String(row.owner_id)},parts);
  }
  override async renderMediaPath(parts:string[],token:string){const r=await this.renderMediaEntry(parts,token);return this.materialize({id:r.owner_id},r.project_id,r.relative_path);}
  override async deleteAsset(owner:Owner,projectId:string,assetId:string){return this.mutateRemote(owner,projectId,async p=>{
    const a=p.assets[assertId(assetId)];if(!a||a.role!=='supporting')throw missing();if(p.jobs.length||Object.values(p.leases).some(l=>l.expiresAt>Date.now()))throw new StorageError(409,'Stop project work before removing footage.');
    for(const id of p.plans){const r=await this.record(owner,'plans',id);if((r.body as {editPlan?:{supporting?:{videoId:string}[]}}).editPlan?.supporting?.some(s=>s.videoId===assetId))throw new StorageError(409,'This footage is used by a saved edit. Keep it or delete the project.');}
    const rows=await this.db.all('SELECT object_key FROM unfold.media_files WHERE project_id=? AND owner_id=? AND (starts_with(relative_path,?) OR starts_with(relative_path,?))',projectId,owner.id,'media/'+assetId+'/','uploads/'+assetId+'.');
    await this.blobs.remove(rows.map(r=>String(r.object_key)));
    await this.db.run("DELETE FROM unfold.refs WHERE kind='assets' AND id=? AND owner_id=?",assetId,owner.id);await this.db.run('DELETE FROM unfold.records WHERE id=? AND owner_id=?',assetId,owner.id);
    await this.db.run('DELETE FROM unfold.media_files WHERE project_id=? AND owner_id=? AND (starts_with(relative_path,?) OR starts_with(relative_path,?))',projectId,owner.id,'media/'+assetId+'/','uploads/'+assetId+'.');delete p.assets[assetId];return {deleted:true,assetId};
  });}
  override async deleteProject(owner:Owner,projectId:string,stopJobs?:(ids:string[])=>Promise<void>){
    const snapshot=await this.getProject(owner,projectId);if(snapshot.jobs.length){if(!stopJobs)throw new StorageError(409,'Cancel project jobs before deleting it.');await stopJobs([...snapshot.jobs]);}
    return this.db.transaction('project:'+projectId,async()=>{
      const p=await this.getProject(owner,projectId);if(Object.values(p.leases).some(l=>l.expiresAt>Date.now())||p.jobs.some(id=>!snapshot.jobs.includes(id))||(p.jobs.length&&!stopJobs))throw new StorageError(409,'Stop active project work before deleting it.');
      const prefix=assertOwner(owner)+'/'+projectId;await this.db.run('INSERT INTO unfold.storage_deletions(prefix,owner_id,created_at,retain_until) VALUES (?,?,?,?) ON CONFLICT(prefix) DO NOTHING',prefix,owner.id,Date.now(),Date.now()+25*3600000);
      await this.db.run("DELETE FROM unfold.jobs WHERE project_id=? AND owner_id=? AND state NOT IN ('pending','running')",projectId,owner.id);
      await this.db.run('DELETE FROM unfold.projects WHERE id=? AND owner_id=?',projectId,owner.id);return {deleted:true,projectId,jobIds:p.jobs};
    });
  }
}
export const isSupabaseStorage=(storage:PrivateStorage):storage is SupabasePrivateStorage=>storage instanceof SupabasePrivateStorage;
