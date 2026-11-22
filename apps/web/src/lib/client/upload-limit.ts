const configured=Number(process.env.NEXT_PUBLIC_UNFOLD_MAX_UPLOAD_BYTES??(process.env.NEXT_PUBLIC_UNFOLD_BACKEND==='supabase'?50:500)*1024*1024);
export const UPLOAD_LIMIT_BYTES=Number.isSafeInteger(configured)&&configured>0?configured:50*1024*1024;
export const UPLOAD_LIMIT_LABEL=Math.floor(UPLOAD_LIMIT_BYTES/1024/1024)+' MB';
