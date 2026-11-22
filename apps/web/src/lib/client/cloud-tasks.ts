/** Short requests only: durable worker execution outlives browser connections. */
export async function* cloudTask<T extends {type:string}>(kind:'generation'|'remix'|'reference',input:unknown,signal?:AbortSignal):AsyncGenerator<T>{
 async function json(url:string,body?:unknown){
  const response=await fetch(url,{...(body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}),signal});
  const value=await response.json();if(!response.ok)throw new Error(value.message??value.error??'This edit is unavailable.');return value;
 }
 const {job}=await json('/api/tasks',{kind,input,idempotencyKey:crypto.randomUUID()});let after=0;
 for(;;){
  signal?.throwIfAborted();
  const current=await json('/api/tasks/'+encodeURIComponent(job.id)+'?after='+after);
  for(const event of current.events){after=Math.max(after,event.cursor);yield event as T;}
  if(current.job.state==='succeeded')return;
  if(current.job.state==='failed'||current.job.state==='cancelled')throw new Error(current.job.error?.message??'The edit stopped before completing.');
  await new Promise<void>((resolve,reject)=>{const cancel=()=>{clearTimeout(timer);reject(new DOMException('Request interrupted','AbortError'));};const timer=setTimeout(()=>{signal?.removeEventListener('abort',cancel);resolve();},1000);signal?.addEventListener('abort',cancel,{once:true});});
 }
}
