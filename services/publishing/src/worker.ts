import { randomUUID } from 'node:crypto';
import { Publisher } from './dispatch.ts';
import type { PublishingRepository } from './repository.ts';

/** A continuously supervised process; the queue and operation fences may live in Postgres. */
export async function runPublishingWorker(store:PublishingRepository,publisher:Publisher,signal:AbortSignal){
 const id=randomUUID(),tasks=new Set<Promise<void>>();
 let heartbeatPending=Promise.resolve(),heartbeatBusy=false,healthy=true;
 const pulse=()=>{if(heartbeatBusy)return heartbeatPending;heartbeatBusy=true;heartbeatPending=Promise.resolve().then(()=>store.heartbeat(id)).then(()=>{healthy=true;},()=>{healthy=false;}).finally(()=>{heartbeatBusy=false;});return heartbeatPending;};
 await pulse();
 const heartbeat=setInterval(()=>{void pulse();},10000);heartbeat.unref();
 try{
  while(!signal.aborted){
   const claim=healthy&&tasks.size<2?await store.claim():null;
   if(!claim){await new Promise<void>(resolve=>{const onAbort=()=>{clearTimeout(timer);resolve();};const timer=setTimeout(()=>{signal.removeEventListener('abort',onAbort);resolve();},500);signal.addEventListener('abort',onAbort,{once:true});});continue;}
   let renewBusy=false,renewPending=Promise.resolve();
   const renew=setInterval(()=>{if(renewBusy)return;renewBusy=true;renewPending=Promise.resolve().then(()=>store.renew(claim.destination.id,claim.token)).catch(()=>{clearInterval(renew);}).finally(()=>{renewBusy=false;});},30000);renew.unref();
   const task=publisher.dispatch(claim).catch(()=>{/* Provider ambiguity remains in the durable operation ledger. */}).finally(async()=>{clearInterval(renew);await renewPending;tasks.delete(task);});tasks.add(task);
  }
 }finally{
  // Keep lease/worker heartbeats alive while accepted operations settle during shutdown.
  await Promise.allSettled(tasks);clearInterval(heartbeat);await heartbeatPending;
 }
}
