import { requireUser } from '@/lib/auth/server';
import { storage } from '@/server/store';
import { isSupabaseStorage } from '@/server/supabase-storage';
import { cloudUploadRequest } from '@/server/cloud-upload-api';
import { apiError } from '@/server/api-errors';
export async function POST(request:Request){
 const user=await requireUser();if(user instanceof Response)return user;
 if(!isSupabaseStorage(storage))return Response.json({error:'Direct uploads are unavailable.'},{status:404});
 try{return Response.json(await cloudUploadRequest(storage,user,request),{headers:{'Cache-Control':'private, no-store'}});}
 catch(error){return apiError(error);}
}
