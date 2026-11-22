import "server-only";
import { createHmac } from "node:crypto";
import { CloudDatabase } from "@unfold/cloud";

const PRODUCTION_ORIGIN = "https://unfold.maazx.dev";
const VISITOR_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_BODY_BYTES = 256;
type Database = Pick<CloudDatabase, "get" | "run" | "transaction">;
let database: CloudDatabase | undefined;

function reply(body: { count: number } | { error: string }, status = 200) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
  });
}

class InvalidVisit extends Error {
  constructor(readonly status: number) { super("Invalid visitor request."); }
}

async function readVisitorId(request: Request) {
  if (request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json") {
    throw new InvalidVisit(415);
  }
  if (Number(request.headers.get("content-length")) > MAX_BODY_BYTES) throw new InvalidVisit(413);
  if (!request.body) throw new InvalidVisit(400);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_BODY_BYTES) {
        await reader.cancel().catch(() => {});
        throw new InvalidVisit(413);
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  let input: unknown;
  try { input = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw new InvalidVisit(400); }
  if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).length !== 1 ||
      !("visitorId" in input) || typeof input.visitorId !== "string" || !VISITOR_ID.test(input.visitorId)) {
    throw new InvalidVisit(400);
  }
  return input.visitorId.toLowerCase();
}

/** All persistence stays behind the server connection; the public API returns only an aggregate. */
export function visitorHandlers({
  db = () => database ??= new CloudDatabase(),
  env = process.env,
}: { db?: () => Database; env?: Record<string, string | undefined> } = {}) {
  async function count(connection: Database) {
    const row = await connection.get("SELECT count(*)::text AS count FROM unfold.landing_visitors");
    const total = Number(row?.count);
    if (!Number.isSafeInteger(total) || total < 0) throw new Error("Visitor aggregate unavailable.");
    return total;
  }
  return {
    async GET() {
      try { return reply({ count: await count(db()) }); }
      catch { return reply({ error: "Visitor count unavailable." }, 503); }
    },
    async POST(request: Request) {
      // Check the actual URL and Host, never a caller-supplied forwarded host.
      // Preview deployments and local QA can read the aggregate, but cannot add visits.
      if (env.NODE_ENV !== "production" || (env.VERCEL_ENV && env.VERCEL_ENV !== "production") ||
          new URL(request.url).origin !== PRODUCTION_ORIGIN ||
          request.headers.get("host") !== "unfold.maazx.dev" ||
          request.headers.get("origin") !== PRODUCTION_ORIGIN ||
          request.headers.get("sec-fetch-site") !== "same-origin") {
        return reply({ error: "Visits are recorded only on the production site." }, 403);
      }
      try {
        const id = await readVisitorId(request);
        // Reuse the existing protected key with a domain-separated HMAC; never persist the raw ID.
        const key = env.UNFOLD_ENCRYPTION_KEY ?? "";
        if (!/^[0-9a-f]{64}$/i.test(key)) throw new Error("Visitor hashing unavailable.");
        const hash = createHmac("sha256", Buffer.from(key, "hex"))
          .update("unfold:landing-visitors:v1\0").update(id).digest("hex");
        const connection = db();
        const total = await connection.transaction("landing-visitors:v1", async () => {
          await connection.run("INSERT INTO unfold.landing_visitors (visitor_hash) VALUES (?) ON CONFLICT (visitor_hash) DO NOTHING", hash);
          return count(connection);
        });
        return reply({ count: total });
      } catch (error) {
        return error instanceof InvalidVisit
          ? reply({ error: error.message }, error.status)
          : reply({ error: "Visitor count unavailable." }, 503);
      }
    },
  };
}
