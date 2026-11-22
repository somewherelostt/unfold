import { visitorHandlers } from "@/server/visitor-counter";
import { connection } from "next/server";

const handlers = visitorHandlers();
export async function GET() {
  await connection();
  return handlers.GET();
}
export async function POST(request: Request) { return handlers.POST(request); }
