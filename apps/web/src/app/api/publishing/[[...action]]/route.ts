import { handlePublishingRequest } from "@/server/publishing/http";
type Context = { params: Promise<{ action?: string[] }> };
const handle = async (request: Request, context: Context) => handlePublishingRequest(request, (await context.params).action ?? []);
export async function GET(request: Request, context: Context) { return handle(request, context); }
export async function HEAD(request: Request, context: Context) { return handle(request, context); }
export async function POST(request: Request, context: Context) { return handle(request, context); }
export async function PATCH(request: Request, context: Context) { return handle(request, context); }
export async function DELETE(request: Request, context: Context) { return handle(request, context); }
