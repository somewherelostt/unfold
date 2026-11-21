"use server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { isAuthConfigured, safeNext } from "@/lib/auth/env";
import { createClient } from "@/lib/auth/server";

export type LoginState =
  | { step: "email"; error?: string; email?: string }
  | { step: "code"; email: string; error?: string; info?: string };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function siteOrigin() {
  if (process.env.NEXT_PUBLIC_SITE_URL) return process.env.NEXT_PUBLIC_SITE_URL.replace(/\/$/, "");
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https");
  return `${proto}://${host}`;
}

/** Step 1: email → the auth provider sends a magic link + 6-digit code. */
export async function sendCode(_prev: LoginState, form: FormData): Promise<LoginState> {
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const next = safeNext(String(form.get("next") ?? ""));
  if (!EMAIL_RE.test(email)) return { step: "email", email, error: "Enter a valid email address." };
  const db = await createClient();
  if (!db) return { step: "email", email, error: "Sign-in is not set up yet. The auth provider is not connected." };

  const origin = await siteOrigin();
  const { error } = await db.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: `${origin}/auth/callback?next=${encodeURIComponent(next)}`, shouldCreateUser: true },
  });
  if (error) return { step: "email", email, error: error.message };
  return { step: "code", email, info: `We sent a sign-in link and a 6-digit code to ${email}.` };
}

/** Step 2: verify the 6-digit code → session cookies set → redirect. */
export async function verifyCode(prev: LoginState, form: FormData): Promise<LoginState> {
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const token = String(form.get("code") ?? "").replace(/\s/g, "");
  const next = safeNext(String(form.get("next") ?? ""));
  if (!/^\d{6,10}$/.test(token)) return { step: "code", email, error: "Enter the code from the email." };
  const db = await createClient();
  if (!db || !isAuthConfigured()) return { step: "email", email, error: "Sign-in is not set up yet." };

  const { error } = await db.auth.verifyOtp({ email, token, type: "email" });
  if (error) return { step: "code", email, error: "That code didn't work. Check it, or send a new one." };
  redirect(next);
}
