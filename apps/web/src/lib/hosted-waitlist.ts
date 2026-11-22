/** Hosted-launch gate. Self-hosted installations keep their normal app by default. */
export function waitlistDecision(request: Request, enabled: boolean): "continue" | "public" | "redirect" | "closed" {
  if (!enabled) return "continue";
  const path = new URL(request.url).pathname;
  if (path === "/api/waitlist" || path === "/api/visitors") return "public";
  const read = request.method === "GET" || request.method === "HEAD";
  if (!read || path.startsWith("/api/") || path.startsWith("/media/")) return "closed";
  if (path === "/" || path === "/waitlist") return "public";
  return "redirect";
}
