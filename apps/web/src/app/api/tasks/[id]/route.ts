import {requireUser} from '@/lib/auth/server';
import {cloudTaskStatus} from '@/server/cloud-tasks';
import {jobApiError} from '@/server/jobs';
export async function GET(request:Request,ctx:{params:Promise<{id:string}>}){
 const owner=await requireUser();if(owner instanceof Response)return owner;
 try{return Response.json(await cloudTaskStatus(owner,(await ctx.params).id,Number(new URL(request.url).searchParams.get('after')??0)),{headers:{'Cache-Control':'private, no-store'}});}
 catch(error){return jobApiError(error);}
}
