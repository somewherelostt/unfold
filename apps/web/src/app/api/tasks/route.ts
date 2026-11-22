import {requireUser} from '@/lib/auth/server';
import {enqueueCloudTask} from '@/server/cloud-tasks';
import {jobApiError} from '@/server/jobs';
export async function POST(request:Request){
 const owner=await requireUser();if(owner instanceof Response)return owner;
 if(request.headers.get('origin')!==new URL(request.url).origin)return Response.json({error:'Open Unfold to create an edit.'},{status:403});
 try{const body=await request.json();if(!body||!['generation','remix','reference'].includes(body.kind)||Object.keys(body).some(k=>!['kind','input','idempotencyKey'].includes(k)))return Response.json({error:'Invalid edit request.'},{status:400});return Response.json({job:await enqueueCloudTask(owner,body.kind,body.input,body.idempotencyKey)},{headers:{'Cache-Control':'private, no-store'}});}
 catch(error){return jobApiError(error);}
}
