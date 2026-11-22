import { visitorHandlers } from "@/server/visitor-counter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const handlers = visitorHandlers();
export async function GET() { return handlers.GET(); }
export async function POST(request: Request) { return handlers.POST(request); }
