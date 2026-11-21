"use client";
import { createBrowserClient } from "@supabase/ssr";
import { AUTH_ANON_KEY, AUTH_URL, isAuthConfigured } from "./env";

/** Browser auth client (public key + session cookies). Returns null until the auth provider is configured. */
export function createClient() {
  if (!isAuthConfigured()) return null;
  return createBrowserClient(AUTH_URL, AUTH_ANON_KEY);
}
