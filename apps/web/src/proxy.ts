import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/auth/proxy";
import { waitlistDecision } from "@/lib/hosted-waitlist";

// Next 16: proxy.ts replaces middleware.ts. Optimistic auth check + session refresh.
// API routes are not redirected here; they call requireUser() from @/lib/auth/server.
export async function proxy(request: NextRequest) {
  const decision = waitlistDecision(request, process.env.UNFOLD_WAITLIST === "1");
  if (decision === "public") return NextResponse.next();
  if (decision === "redirect") return NextResponse.redirect(new URL("/waitlist", request.url));
  if (decision === "closed") return NextResponse.json({ error: "Hosted access is not open yet. Join the waitlist at /waitlist." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  if (request.nextUrl.pathname.startsWith("/api/")) return NextResponse.next();
  return updateSession(request);
}

export const config = {
  matcher: [
    "/((?!api/|_next/static|_next/image|favicon.ico|demo/|assets/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|mp4|mp3|wav|json)$).*)",
    "/api/:path*",
  ],
};
