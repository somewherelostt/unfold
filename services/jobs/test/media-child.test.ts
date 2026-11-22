import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {test} from 'node:test';

test('analysis child forwards shutdown to the detached media tool before exiting',async t=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'unfold-media-child-stop-'));
 const toolPidFile=path.join(root,'tool.pid');let toolPid:number|undefined;
 const repo=path.resolve(import.meta.dirname,'../../..');
 await mkdir(path.join(root,'services/media/src'),{recursive:true});
 await writeFile(path.join(root,'services/media/src/analyze.ts'),`import {run} from ${JSON.stringify(pathToFileURL(path.join(repo,'services/media/src/util.ts')).href)};
 export async function analyzeVideo(input,options){await run(process.execPath,['-e',input],{signal:options.signal});return {};}`);
 const request=path.join(root,'request.json'),result=path.join(root,'result.json');
 await writeFile(request,JSON.stringify({kind:'analysis',repoRoot:root,inputPath:`require('node:fs').writeFileSync(${JSON.stringify(toolPidFile)},String(process.pid));setInterval(()=>{},1000);`,options:{}}));
 const child=spawn(process.execPath,['--import',path.join(repo,'packages/video/node_modules/tsx/dist/loader.mjs'),path.join(repo,'services/jobs/scripts/media-child.ts'),request,result],{stdio:'ignore'});
 t.after(async()=>{child.kill('SIGKILL');if(toolPid){try{process.kill(-toolPid,'SIGKILL');}catch{}}await rm(root,{recursive:true,force:true});});
 const closed=new Promise<number|null>(resolve=>child.once('close',resolve));
 for(let i=0;i<300;i++){try{toolPid=Number(await readFile(toolPidFile,'utf8'));break;}catch{await delay(10);}}
 assert.ok(toolPid,'real detached media tool started');
 child.kill('SIGTERM');
 const status=await Promise.race([closed,delay(5000).then(()=>{throw Error('analysis child did not drain');})]);
 assert.notEqual(status,0);
 for(let i=0;i<100;i++){try{process.kill(toolPid,0);await delay(10);}catch{break;}}
 assert.throws(()=>process.kill(toolPid!,0),{code:'ESRCH'});
});
