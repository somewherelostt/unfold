import test, { beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { CloudDatabase } from '../src/database.ts';
import { PostgresJobStore } from '../../../services/jobs/src/postgres-store.ts';
import { PostgresPublishingStore } from '../../../services/publishing/src/postgres-store.ts';

const url = process.env.UNFOLD_TEST_DATABASE_URL ?? 'postgresql://127.0.0.1:55432/unfold_test';
const target = new URL(url);
if (!['127.0.0.1','localhost'].includes(target.hostname) || !target.pathname.endsWith('_test')) throw new Error('These destructive fixtures require a disposable loopback *_test database.');
const admin = new CloudDatabase(url), stores=[];
beforeEach(async()=> { await admin.query('TRUNCATE unfold.projects,unfold.jobs,unfold.worker_heartbeats,unfold.publishing_posts,unfold.publishing_accounts,unfold.publishing_connections,unfold.publishing_operations,unfold.publishing_delivery,unfold.publishing_workers,unfold.publishing_admission CASCADE'); });
after(async()=> { await Promise.all(stores.map(s=>s.close())); await admin.close(); });
function jobs(limits={}) { const s = new PostgresJobStore({databaseUrl:url,databasePath:'/tmp/cloud-queue',artifactRoot:'/tmp/cloud-test-jobs',limits});stores.push(s);return s; }
function publishing(now=Date.now, lease=120000) { const s=new PostgresPublishingStore('cloud',now,lease,url);stores.push(s);return s; }
const owner={id:'owner-fixture'}, foreign={id:'other-fixture'},ctx={ownerId:owner.id,projectId:'project_fixture'};
const request={kind:'analysis',input:{kind:'upload',id:'upload_fixture'},idempotencyKey:'same-immutable-request'};
const account=(id='account_fixture')=>({id,ownerId:owner.id,platform:'instagram',providerAccountId:'ca_fixture',providerUserId:'provider_fixture',authConfigId:'ac_fixture',status:'connected',identity:{id:'123',handle:'fixture',name:'Fixture'},requestedScopes:[],verifiedAt:Date.now(),createdAt:Date.now()});
const media={ref:{projectId:ctx.projectId,fileKey:'complete.mp4'},mediaContentSha256:'f'.repeat(64),properties:{bytes:100,duration:10,width:720,height:1280,fps:30,videoCodec:'h264',audioCodec:'aac',mime:'video/mp4'},previewUrl:'/media/project_fixture/exports/complete.mp4'};
const input={accountId:'account_fixture',platform:'instagram',text:'A database fixture, never a live post',instagram:{shareToFeed:false,thumbnailMs:0}};
const schedule={mode:'now',at:Date.now(),timeZone:'UTC',localDateTime:'2026-11-22T00:00',offsetMinutes:0};

test('two independent PostgreSQL clients enqueue once and compete for one fenced media claim', async()=> {
 const a=jobs({maxRunning:1}),b=jobs({maxRunning:1});
 const [first,second]=await Promise.all([a.enqueue(ctx,request),b.enqueue(ctx,request)]);
 assert.equal(first.job.id,second.job.id);assert.equal([first.created,second.created].filter(Boolean).length,1);
 const claims=await Promise.all([a.claim('worker_a'),b.claim('worker_b')]);const claim=claims.find(Boolean);
 assert.equal(claims.filter(Boolean).length,1);assert.ok(claim.lease.token);
 await assert.rejects(a.get({ownerId:foreign.id,projectId:ctx.projectId},claim.id),/not found/);
 await a.heartbeat(claim,{fraction:.2,stage:'analyzing'});
 await b.cancel(ctx,claim.id);assert.equal((await a.heartbeat(claim)).cancelRequested,true);
 const finished=await a.finish(claim,{output:{kind:'analysis',id:'result_fixture'}});assert.equal(finished.state,'cancelled');
 assert.equal((await a.events(ctx,claim.id)).at(-1).data.state,'cancelled');
});
test('a failed enqueue rolls back all database changes and immutable settings cannot change',async()=> {
 const a=jobs();const job=await a.enqueue(ctx,request);
 await assert.rejects(a.enqueue(ctx,{...request,input:{kind:'upload',id:'changed'}}),/different settings/);
 assert.equal((await a.get(ctx,job.job.id)).state,'pending');
 const claim=await a.claim('worker');await a.finish(claim,{output:{kind:'analysis',id:'result'}});
 assert.equal((await a.health()).storage,true);
});
test('independent publishing clients never claim or reserve a public mutation twice',async()=> {
 const a=publishing(),b=publishing();await a.putAccount(account());
 const post=await a.create(owner,media,[input],schedule,'publishing-fixture-one');
 assert.equal((await b.create(owner,media,[input],schedule,'publishing-fixture-one')).id,post.id);
 await assert.rejects(a.get(foreign,post.id),/Not found/);
 const claims=await Promise.all([a.claim(),b.claim()]);assert.equal(claims.filter(Boolean).length,1);const c=claims.find(Boolean);
 const op=await a.reserveOperation(c.destination.id,c.token,'instagram_publish');
 await assert.rejects(b.reserveOperation(c.destination.id,c.token,'instagram_publish'),/verification/);
 await a.completeOperation(c.destination.id,c.token,op,{postId:'987'});
 await a.release(c.destination.id,c.token,{state:'published',checkpoint:{permalink:'https://www.instagram.com/reel/fixture/'}});
 assert.equal((await b.get(owner,post.id)).destinations[0].state,'published');assert.equal(await b.claim(),null);
});
test('expired accepted mutations reconcile without republishing and deletion leaves an admission fence',async()=> {
 let now=Date.now();const a=publishing(()=>now,1000),b=publishing(()=>now,1000);await a.putAccount(account());
 const post=await a.create(owner,media,[input],{...schedule,at:now},'publishing-fixture-two');const claim=await a.claim();
 const op=await a.reserveOperation(claim.destination.id,claim.token,'instagram_publish');await a.checkpointOperation(claim.destination.id,claim.token,op,{containerId:'456'});
 now+=1001;const recovered=await b.claim();assert.equal(recovered.destination.state,'reconciling');
 await assert.rejects(a.completeOperation(claim.destination.id,claim.token,op,{postId:'987'}),/ownership changed/);
 await assert.rejects(b.reserveOperation(recovered.destination.id,recovered.token,'instagram_publish'),/verification/);
 await b.release(recovered.destination.id,recovered.token,{state:'unknown'});
 await assert.rejects(a.retry(owner,post.id,claim.destination.id),/cannot safely/);
 assert.equal((await a.beginDeletion(owner,ctx.projectId)).ready,false);
 await assert.rejects(a.create(owner,media,[input],schedule,'publishing-fixture-three'),/being removed/);
});
test('connection state remains one-use and owner-bound in PostgreSQL',async()=> {
 const a=publishing();const {state}=await a.beginConnection(owner,'instagram','account_fixture');
 const pending={...account(),status:'connecting',identity:null,verifiedAt:null};await a.putAccount(pending);
 await assert.rejects(a.connection(foreign,state),/invalid or expired/);
 await a.completeConnection(owner,state,account());
 await assert.rejects(a.connection(owner,state),/invalid or expired/);
 assert.equal((await a.listAccounts(owner)).length,1);assert.equal((await a.listAccounts(foreign)).length,0);
});
