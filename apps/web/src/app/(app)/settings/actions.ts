"use server";
import { revalidatePath } from "next/cache";
import { deleteUserApiKey, getStoredUserApiKey, saveUserApiKey } from "@/lib/auth/api-keys";
import { CEREBRAS_MODEL, isProvider, type Provider } from "@/lib/auth/providers";
import { getUser } from "@/lib/auth/server";

export type SaveState = { ok?: boolean; error?: string; last4?: string };
export type TestResult = { ok: boolean; message: string; models?: string[]; ms?: number };

export async function saveKey(_prev: SaveState, form: FormData): Promise<SaveState> {
  const user = await getUser();
  if (!user) return { error: "Sign in first." };
  const provider = form.get("provider");
  const key = String(form.get("key") ?? "").trim();
  if (!isProvider(provider)) return { error: "Unknown provider." };
  if (key.length < 8 || key.length > 512 || /\s/.test(key)) return { error: "That doesn't look like an API key." };
  try {
    const saved = await saveUserApiKey(user.id, provider, key);
    revalidatePath("/settings");
    return { ok: true, last4: saved.last4 };
  } catch (err) {
    return { error: (err as Error).message };
  }
}

export async function removeKey(provider: Provider): Promise<SaveState> {
  const user = await getUser();
  if (!user) return { error: "Sign in first." };
  if (!isProvider(provider)) return { error: "Unknown provider." };
  try {
    await deleteUserApiKey(user.id, provider);
    revalidatePath("/settings");
    return { ok: true };
  } catch (err) {
    return { error: (err as Error).message };
  }
}

/** Checks the user's saved key against the model list, without a shared-key fallback. */
export async function testCerebrasKey(): Promise<TestResult> {
  const user = await getUser();
  if (!user) return { ok: false, message: "Sign in first." };
  let key: string | null;
  try {
    key = await getStoredUserApiKey(user.id, "cerebras");
  } catch {
    return { ok: false, message: "Couldn't read your saved key. Replace it and try again." };
  }
  if (!key) return { ok: false, message: "No Cerebras key saved yet." };
  const base = (process.env.CEREBRAS_BASE_URL || "https://api.cerebras.ai/v1").replace(/\/$/, "");
  const started = Date.now();
  try {
    const res = await fetch(`${base}/models`, {
      headers: { Authorization: `Bearer ${key}` },
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    const ms = Date.now() - started;
    if (res.status === 401 || res.status === 403) return { ok: false, ms, message: "Cerebras rejected this key." };
    if (!res.ok) return { ok: false, ms, message: `Cerebras returned ${res.status}.` };
    const body = (await res.json()) as { data?: { id: string }[] };
    const models = (body.data ?? []).map((m) => m.id);
    const found = models.includes(CEREBRAS_MODEL);
    return found
      ? { ok: true, ms, models, message: "Saved key works. Kimi K3.1 Pro is available." }
      : { ok: false, ms, models, message: "Saved key works, but Kimi K3.1 Pro isn't available on this account." };
  } catch (err) {
    return { ok: false, message: `Couldn't reach Cerebras: ${(err as Error).message}` };
  }
}
