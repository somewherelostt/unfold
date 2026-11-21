import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/auth/proxy";

// Next 16: proxy.ts replaces middleware.ts. Optimistic auth check + session refresh.
// API routes are not redirected here; they call requireUser() from @/lib/auth/server.
export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    "/((?!api/|_next/static|_next/image|favicon.ico|demo/|assets/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|mp4|mp3|wav|json)$).*)",
  ],
};
