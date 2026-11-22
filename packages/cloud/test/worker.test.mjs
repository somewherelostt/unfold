import test,{after,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {CloudDatabase} from '../src/database.ts';
import {PostgresJobStore} from '../../../services/jobs/src/postgres-store.ts';
import {CloudJobWorker} from '../../../services/jobs/src/cloud-worker.ts';
const url=process.env.UNFOLD_TEST_DATABASE_URL??'postgresql://127.0.0.1:55432/unfold_test';const target=new URL(url);
if(!['127.0.0.1','localhost'].includes(target.hostname)||!target.pathname.endsWith('_test'))throw Error('Disposable loopback *_test database required.');
const db=new CloudDatabase(url),root=await mkdtemp(path.join(tmpdir(),'cloud-worker-test-')),stores=[];
const ctx={ownerId:'worker_owner',projectId:'worker_project'};
beforeEach(async()=>{await db.query('TRUNCATE unfold.projects,unfold.jobs,unfold.worker_heartbeats CASCADE');await db.run('INSERT INTO unfold.projects(id,owner_id,body,updated_at) VALUES (?,?,?::jsonb,?)',ctx.projectId,ctx.ownerId,JSON.stringify({state:'active'}),Date.now());});
after(async()=>{await Promise.all(stores.map(s=>s.close()));await db.close();await rm(root,{recursive:true,force:true});});
const queue=()=>{const s=new PostgresJobStore({databaseUrl:url,databasePath:'postgres',artifactRoot:root});stores.push(s);return s;};
test('fenced worker completion atomically publishes prepared media; cancellation does not',async()=>{
 const q=queue();const {job}=await q.enqueue(ctx,{kind:'render',input:{kind:'plan',id:'snapshot',revision:'immutable'},idempotencyKey:'worker-render-test'});
 const file='media/exports/'+job.id+'.mp4';
 await db.run('INSERT INTO unfold.media_files(project_id,relative_path,owner_id,object_key,sha256,bytes,mime,completed,created_at) VALUES (?,?,?,?,?,?,?,false,?)',ctx.projectId,file,ctx.ownerId,'fixture/blob','a'.repeat(64),10,'video/mp4',Date.now());
 const worker=new CloudJobWorker(q,{handlers:{render:async c=>{c.progress({fraction:.5,stage:'rendering'});assert.equal((await db.get('SELECT completed FROM unfold.media_files WHERE relative_path=?',file)).completed,false);return{output:{kind:'video',id:c.job.id}};}}});
 assert.equal(await worker.tick(),1);await worker.drain();assert.equal((await q.get(ctx,job.id)).state,'succeeded');assert.equal((await db.get('SELECT completed FROM unfold.media_files WHERE relative_path=?',file)).completed,true);await worker.stop();
 const next=await q.enqueue(ctx,{kind:'render',input:{kind:'plan',id:'snapshot',revision:'immutable'},idempotencyKey:'worker-cancel-test'});const claim=await q.claim('cancel_worker');await q.cancel(ctx,next.job.id);await q.finish(claim,{output:{kind:'video',id:claim.id}});assert.equal((await q.get(ctx,next.job.id)).state,'cancelled');
});
test('AI task kinds require immutable snapshots and run once without automatic paid retry',async()=>{
 const q=queue();await assert.rejects(q.enqueue(ctx,{kind:'generation',input:{kind:'snapshot',id:'snapshot'},idempotencyKey:'generation-fixture'}),/revision/);
 const {job}=await q.enqueue(ctx,{kind:'generation',input:{kind:'snapshot',id:'snapshot',revision:'hash'},idempotencyKey:'generation-fixture'});let executions=0;
 const worker=new CloudJobWorker(q,{handlers:{generation:async c=>{executions++;throw Error('fixture failure');}}});
 await worker.tick();await worker.drain();assert.equal((await q.get(ctx,job.id)).state,'failed');assert.equal(await worker.tick(),0);assert.equal(executions,1);await worker.stop();
});
