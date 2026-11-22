import test,{after,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {CloudDatabase} from '../src/database.ts';
import {SupabasePrivateStorage} from '../../../apps/web/src/server/supabase-storage.ts';
const url=process.env.UNFOLD_TEST_DATABASE_URL??'postgresql://127.0.0.1:55432/unfold_test';
const target=new URL(url);
if(!['127.0.0.1','localhost'].includes(target.hostname)||!target.pathname.endsWith('_test'))throw Error('Disposable loopback *_test database required.');
const db=new CloudDatabase(url),root=await mkdtemp(path.join(tmpdir(),'unfold-cloud-storage-'));
const objects=new Map();
const blobs={bucket:'private-fixture',async signedUpload(key){return{token:'fixture-only',endpoint:'https://storage.invalid/upload/resumable'};},async info(key){const b=objects.get(key);if(!b)throw Error('missing fixture object');return{bytes:b.length,mime:'video/mp4'};},async upload(key,file){objects.set(key,await readFile(file));},async download(key,file,bytes,hash){const b=objects.get(key);assert.equal(b.length,bytes);await mkdir(path.dirname(file),{recursive:true});await writeFile(file,b);},async bytes(key){return objects.get(key);},async signedRead(key){return'https://storage.invalid/private/'+key;},async remove(keys){keys.forEach(k=>objects.delete(k));}};
const storage=new SupabasePrivateStorage(root,{db,blobs}),owner={id:'cloud_owner'},foreign={id:'cloud_other'};
beforeEach(async()=>{objects.clear();await db.query('TRUNCATE unfold.projects,unfold.storage_deletions CASCADE');delete process.env.UNFOLD_CLOUD_WORKER;});
after(async()=>{delete process.env.UNFOLD_CLOUD_WORKER;await db.close();await rm(root,{recursive:true,force:true});});
async function uploaded(){const grant=await storage.beginUpload(owner,{filename:'real-video.mp4',bytes:5,role:'primary'});objects.set(grant.objectKey,Buffer.from('video'));await storage.completeUpload(owner,grant.videoId);return grant;}
test('direct upload grants remain pending until exact size completes, with owner-only access',async()=>{
 const g=await storage.beginUpload(owner,{filename:'real-video.mp4',bytes:5,role:'primary'});
 assert.equal(g.contentType,'video/mp4');assert.equal(g.bucket,'private-fixture');
 await assert.rejects(storage.getAsset(owner,g.videoId),/Finish uploading/);
 objects.set(g.objectKey,Buffer.from('bad'));await assert.rejects(storage.completeUpload(owner,g.videoId),/incomplete/);
 await assert.rejects(storage.completeUpload(foreign,g.videoId),e=>e.status===404);
 objects.set(g.objectKey,Buffer.from('video'));await storage.completeUpload(owner,g.videoId);
 assert.equal((await storage.getAsset(owner,g.videoId)).filename,'real-video.mp4');
 await assert.rejects(storage.getProject(foreign,g.projectId),e=>e.status===404);
 await assert.rejects(storage.signedMedia(owner,[g.projectId,'exports','invented.mp4']),e=>e.status===404);
});
test('independent PostgreSQL storage objects enforce compare-and-swap and immutable worker snapshots',async()=>{
 const g=await uploaded(),b=new SupabasePrivateStorage(root,{db:new CloudDatabase(url),blobs});
 try{
 await storage.putRecord(owner,g.projectId,'plans','plan_fixture',{revision:1,updatedAt:0,title:'original'});
 const outcomes=await Promise.allSettled([storage.reviseRecord(owner,g.projectId,'plan_fixture',1,async p=>({...p,title:'one'})),b.reviseRecord(owner,g.projectId,'plan_fixture',1,async p=>({...p,title:'two'}))]);
 assert.equal(outcomes.filter(r=>r.status==='fulfilled').length,1);assert.equal(outcomes.find(r=>r.status==='rejected').reason.status,409);
 const input=await storage.putJobInput(owner,g.projectId,'input_fixture',{source:'immutable'});
 await assert.rejects(b.putJobInput(owner,g.projectId,'input_fixture',{source:'changed'}),/immutable/);
 assert.deepEqual(await b.getJobInput(owner,g.projectId,'input_fixture',input.revision),{source:'immutable'});
 }finally{await b.db.close();}
});
test('Vercel access never materializes videos; render capabilities are exact-file and revocable',async()=>{
 const g=await uploaded();process.env.UNFOLD_CLOUD_WORKER='1';
 const folder=path.join(storage.projectDir(g.projectId),'media',g.videoId);await mkdir(folder,{recursive:true});await writeFile(path.join(folder,'source.mp4'),'normalized video');
 await storage.publishFile(owner,g.projectId,'media/'+g.videoId+'/source.mp4',true);
 const parts=[g.projectId,g.videoId,'source.mp4'];delete process.env.UNFOLD_CLOUD_WORKER;
 await assert.rejects(storage.mediaPath(owner,parts),/media worker/);
 const cap=await storage.createRenderAccess(owner,g.projectId,['/media/'+parts.join('/')]);
 assert.ok((await storage.renderMediaEntry(parts,cap.token)).object_key);
 await assert.rejects(storage.renderMediaEntry([g.projectId,g.videoId,'different.mp4'],cap.token),e=>e.status===404);
 await cap.release();await assert.rejects(storage.renderMediaEntry(parts,cap.token),e=>e.status===404);
});
test('deletion waits for active distributed leases, then revokes ownership and queues late-upload cleanup',async()=>{
 const g=await uploaded(),release=await storage.acquireLease(owner,g.projectId,'fixture');
 await assert.rejects(storage.deleteProject(owner,g.projectId),e=>e.status===409);
 await release();await storage.deleteProject(owner,g.projectId);
 await assert.rejects(storage.getProject(owner,g.projectId),e=>e.status===404);
 await assert.rejects(storage.completeUpload(owner,g.videoId),e=>e.status===404);
 const queue=await db.get('SELECT * FROM unfold.storage_deletions WHERE prefix=?',owner.id+'/'+g.projectId);
 assert.ok(Number(queue.retain_until)>Date.now()+24*3600000);
});
