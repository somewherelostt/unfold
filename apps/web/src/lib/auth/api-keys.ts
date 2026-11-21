/**
 * Encrypted per-user API key storage (table public.api_keys, RLS: owner only). Server only.
 *
 * Agent usage:  const key = await getUserApiKey(user.id, "cerebras");  // falls back to env
 *
 * When the database isn't configured and UNFOLD_DEV_NO_AUTH=1, keys live in process memory (still encrypted).
 */
import { decrypt, encrypt, type Sealed } from "@/lib/crypto";
import { isDevNoAuth, isAuthConfigured } from "./env";
import type { Provider } from "./providers";
import { createAdminClient, createClient } from "./server";

export type StoredKeyInfo = { provider: Provider; last4: string; createdAt: string };
type Row = Sealed & { provider: Provider; last4: string; created_at: string };

const ENV_FALLBACK: Record<Provider, string | undefined> = {
  cerebras: "CEREBRAS_API_KEY",
  gpu: "GPU_API_KEY",
};

// Dev-bypass memory store, survives hot reloads.
const g = globalThis as unknown as { __unfoldDevKeys?: Map<string, Row> };
const devStore = (g.__unfoldDevKeys ??= new Map<string, Row>());
const inDevMemoryMode = () => !isAuthConfigured() && isDevNoAuth();

/** Keys the signed-in user has connected (never the key itself). */
export async function listUserKeys(userId: string): Promise<StoredKeyInfo[]> {
  if (inDevMemoryMode()) {
    return [...devStore.entries()]
      .filter(([k]) => k.startsWith(`${userId}:`))
      .map(([, r]) => ({ provider: r.provider, last4: r.last4, createdAt: r.created_at }));
  }
  const db = await createClient();
  if (!db) return [];
  const { data, error } = await db.from("api_keys").select("provider,last4,created_at").eq("user_id", userId);
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => ({ provider: r.provider as Provider, last4: r.last4, createdAt: r.created_at }));
}

export async function saveUserApiKey(userId: string, provider: Provider, key: string): Promise<StoredKeyInfo> {
  const sealed = encrypt(key);
  const row: Row = { ...sealed, provider, last4: key.slice(-4), created_at: new Date().toISOString() };
  if (inDevMemoryMode()) {
    devStore.set(`${userId}:${provider}`, row);
  } else {
    const db = await createClient();
    if (!db) throw new Error("The database is not configured.");
    const { error } = await db
      .from("api_keys")
      .upsert({ user_id: userId, ...row }, { onConflict: "user_id,provider" });
    if (error) throw new Error(error.message);
  }
  return { provider, last4: row.last4, createdAt: row.created_at };
}

export async function deleteUserApiKey(userId: string, provider: Provider): Promise<void> {
  if (inDevMemoryMode()) {
    devStore.delete(`${userId}:${provider}`);
    return;
  }
  const db = await createClient();
  if (!db) throw new Error("The database is not configured.");
  const { error } = await db.from("api_keys").delete().eq("user_id", userId).eq("provider", provider);
  if (error) throw new Error(error.message);
}

/** The user's own stored key (from their session, or service role when called outside a request). No env fallback. */
export async function getStoredUserApiKey(userId: string, provider: Provider): Promise<string | null> {
  let row: Row | null | undefined;
  if (inDevMemoryMode()) {
    row = devStore.get(`${userId}:${provider}`);
  } else {
    let db = createAdminClient();
    if (!db) {
      try {
        db = await createClient();
      } catch {
        db = null; // outside a request scope
      }
    }
    if (!db) return null;
    const { data, error } = await db
      .from("api_keys")
      .select("provider,ciphertext,iv,tag,last4,created_at")
      .eq("user_id", userId)
      .eq("provider", provider)
      .maybeSingle();
    if (error) throw new Error(error.message);
    row = data as Row | null;
  }
  return row ? decrypt(row) : null;
}

/**
 * Key for the agent / server code: the user's stored key, else the server env key
 * (CEREBRAS_API_KEY, GPU_API_KEY). Null if neither exists.
 */
export async function getUserApiKey(userId: string | null | undefined, provider: Provider): Promise<string | null> {
  if (userId) {
    try {
      const own = await getStoredUserApiKey(userId, provider);
      if (own) return own;
    } catch (err) {
      console.warn(`[unfold] could not read ${provider} key for user, using env fallback:`, (err as Error).message);
    }
  }
  const envName = ENV_FALLBACK[provider];
  return (envName && process.env[envName]) || null;
}
