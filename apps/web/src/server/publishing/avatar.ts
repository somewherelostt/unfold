import type { ComposioClient } from "../../../../../services/publishing/src/composio.ts";
import type { PublishingStore } from "../../../../../services/publishing/src/store.ts";
import type { Owner } from "../../../../../services/publishing/src/types.ts";

const MAX_BYTES = 512 * 1024, MAX_CACHE_BYTES = 4 * 1024 * 1024, TTL_MS = 5 * 60_000;
type Picture = { bytes: Uint8Array; type: string; expiresAt: number };
const cache = new Map<string, Picture>();
const pending = new Map<string, Promise<Picture>>();
let cachedBytes = 0;
const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer", "Cross-Origin-Resource-Policy": "same-origin" };

function privateImage(url: URL, signal: AbortSignal) {
  // Bypass framework fetch instrumentation: temporary CDN query strings must not enter URL logs.
  return new Promise<Response>((resolve, reject) => {
    const request = get(url, { headers: { Accept: "image/jpeg,image/png,image/webp" }, signal }, (response) => {
      if (response.statusCode !== 200) { response.destroy(); resolve(new Response(null, { status: 502 })); return; }
      const imageHeaders = new Headers();
      for (const name of ["content-type", "content-length"]) { const value = response.headers[name]; if (typeof value === "string") imageHeaders.set(name, value); }
      resolve(new Response(Readable.toWeb(response) as ReadableStream<Uint8Array>, { headers: imageHeaders }));
    });
    request.on("error", reject);
  });
}

function validRaster(bytes: Uint8Array, type: string) {
  if (type === "image/jpeg") return bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if (type === "image/png") return bytes.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((value, i) => bytes[i] === value);
  if (type === "image/webp") return bytes.length >= 12 && Buffer.from(bytes.subarray(0, 4)).toString() === "RIFF" && Buffer.from(bytes.subarray(8, 12)).toString() === "WEBP";
  return false;
}
function remember(key: string, picture: Picture) {
  for (const [oldKey, old] of cache) if (old.expiresAt <= Date.now()) { cache.delete(oldKey); cachedBytes -= old.bytes.length; }
  while (cache.size >= 32 || cachedBytes + picture.bytes.length > MAX_CACHE_BYTES) { const first = cache.entries().next().value; if (!first) break; cache.delete(first[0]); cachedBytes -= first[1].bytes.length; }
  cache.set(key, picture); cachedBytes += picture.bytes.length;
}

/** Owner-authorized image delivery; signed provider URLs never leave this request. */
export async function serveAccountAvatar(owner: Owner, accountId: string, store: PublishingStore, client: ComposioClient, options: { fetcher?: typeof fetch; timeoutMs?: number } = {}) {
  // Authorize before reading memory, including every cache hit and in-flight request.
  const account = store.account(owner, accountId);
  if (account.status !== "connected" || account.platform !== "instagram" || !account.identity) return new Response(null, { status: 404, headers });
  const identityId = account.identity.id;
  const key = `${owner.id}\0${account.id}\0${account.providerAccountId}\0${identityId}`;
  try {
    let picture = cache.get(key);
    if (!picture || picture.expiresAt <= Date.now()) {
      let work = pending.get(key);
      if (!work) {
        work = (async (): Promise<Picture> => {
          const profile = await client.execute(account, "INSTAGRAM_GET_USER_INFO", { ig_user_id: identityId, fields: "id,profile_picture_url" }, false);
          if (profile.id !== identityId || typeof profile.profile_picture_url !== "string") throw Error("Avatar unavailable");
          const url = new URL(profile.profile_picture_url);
          if (url.protocol !== "https:" || url.username || url.password || url.port || url.hash || !["cdninstagram.com", "fbcdn.net"].some((domain) => url.hostname === domain || url.hostname.endsWith(`.${domain}`))) throw Error("Avatar unavailable");
          const signal = AbortSignal.timeout(options.timeoutMs ?? 8000);
          const response = options.fetcher ? await options.fetcher(url, { headers: { Accept: "image/jpeg,image/png,image/webp" }, signal, redirect: "error", cache: "no-store" }) : await privateImage(url, signal);
          const type = response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() ?? "";
          if (!response.ok || !["image/jpeg", "image/png", "image/webp"].includes(type) || Number(response.headers.get("content-length") ?? 0) > MAX_BYTES || !response.body) { await response.body?.cancel(); throw Error("Avatar unavailable"); }
          const reader = response.body.getReader(), chunks: Uint8Array[] = []; let length = 0;
          try { for (;;) { const next = await reader.read(); if (next.done) break; length += next.value.length; if (length > MAX_BYTES) { await reader.cancel(); throw Error("Avatar unavailable"); } chunks.push(next.value); } } finally { reader.releaseLock(); }
          const bytes = new Uint8Array(length); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
          if (!validRaster(bytes, type)) throw Error("Avatar unavailable");
          const result = { bytes, type, expiresAt: Date.now() + TTL_MS }; remember(key, result); return result;
        })();
        pending.set(key, work);
        void work.finally(() => pending.delete(key)).catch(() => {});
      }
      picture = await work;
    }
    // A disconnect during the network request must win before bytes are returned.
    const current = store.account(owner, accountId);
    if (current.status !== "connected" || current.providerAccountId !== account.providerAccountId || current.identity?.id !== identityId) return new Response(null, { status: 404, headers });
    return new Response(Buffer.from(picture.bytes), { headers: { ...headers, "Content-Type": picture.type, "Content-Length": String(picture.bytes.length) } });
  } catch { return new Response(null, { status: 404, headers }); }
}
import { get } from "node:https";
import { Readable } from "node:stream";
