import "server-only";
import { createHmac } from "node:crypto";
import { CloudDatabase } from "@unfold/cloud";

type Database = Pick<CloudDatabase, "get" | "run" | "transaction">;
let database: CloudDatabase | undefined;
const reply = (status: number, body: { joined: true } | { error: string }) => Response.json(body, { status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });

export function waitlistHandler({ db = () => database ??= new CloudDatabase(), env = process.env }: { db?: () => Database; env?: Record<string, string | undefined> } = {}) {
  return async function POST(request: Request) {
    if (request.headers.get("origin") !== new URL(request.url).origin || request.headers.get("sec-fetch-site") !== "same-origin") return reply(403, { error: "Submit the form from this website." });
    if (request.headers.get("content-type")?.split(";", 1)[0] !== "application/json") return reply(415, { error: "Send JSON." });
    if (Number(request.headers.get("content-length")) > 2048 || !request.body) return reply(400, { error: "Invalid signup." });
    let input: unknown;
    const reader = request.body.getReader(); const chunks: Uint8Array[] = []; let bytes = 0;
    try {
      for (;;) { const item = await reader.read(); if (item.done) break; bytes += item.value.byteLength;
        if (bytes > 2048) { await reader.cancel(); return reply(400, { error: "Invalid signup." }); } chunks.push(item.value); }
      input = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch { return reply(400, { error: "Invalid signup." }); }
    finally { reader.releaseLock(); }
    if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).some(key => !["email", "website"].includes(key)) || !("email" in input) || typeof input.email !== "string") return reply(400, { error: "Enter a valid email address." });
    if ("website" in input && typeof input.website !== "string") return reply(400, { error: "Invalid signup." });
    if ("website" in input && input.website) return reply(200, { joined: true });
    const email = input.email.trim().toLowerCase();
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return reply(400, { error: "Enter a valid email address." });
    try {
      const key = env.UNFOLD_ENCRYPTION_KEY ?? "";
      if (!/^[a-f0-9]{64}$/i.test(key)) throw new Error("Waitlist unavailable.");
      const address = request.headers.get("x-vercel-forwarded-for") ?? request.headers.get("x-forwarded-for") ?? "unknown";
      const hash = createHmac("sha256", Buffer.from(key, "hex")).update("unfold:waitlist-rate:v1\0").update(address.split(",", 1)[0].trim()).digest("hex");
      const connection = db();
      return await connection.transaction("waitlist-rate:" + hash, async () => {
        await connection.run("DELETE FROM unfold.waitlist_limits WHERE reset_at < now()");
        const row = await connection.get("INSERT INTO unfold.waitlist_limits (key, attempts, reset_at) VALUES (?,1,now()+interval '1 hour') ON CONFLICT (key) DO UPDATE SET attempts=unfold.waitlist_limits.attempts+1 RETURNING attempts", hash);
        if (Number(row?.attempts) > 5) return reply(429, { error: "Too many requests. Try again in an hour." });
        await connection.run("INSERT INTO unfold.waitlist_entries (email, consent_version) VALUES (?, 'launch-v1') ON CONFLICT DO NOTHING", email);
        return reply(200, { joined: true });
      });
    } catch { return reply(503, { error: "The waitlist is temporarily unavailable. Please try again shortly." }); }
  };
}
