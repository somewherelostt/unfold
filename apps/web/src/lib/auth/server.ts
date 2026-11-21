/**
 * Server-side auth + database helpers for Server Components, Server Actions and Route Handlers.
 *
 *   const user = await getUser();                 // AppUser | null
 *   const user = await requireUser();             // in route handlers:
 *   if (user instanceof Response) return user;    // 401 JSON when signed out
 *
 * With Cache Components on, pages that call these must render them inside <Suspense>.
 */
import { createServerClient } from "@supabase/ssr";
import { createClient as createRawClient, type SupabaseClient as DbClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { DEV_USER, AUTH_ANON_KEY, AUTH_URL, isDevNoAuth, isAuthConfigured } from "./env";

export type AppUser = { id: string; email: string | null; dev?: boolean };

/** Per-request server client bound to the user's auth cookies. Null when the auth provider isn't configured. */
export async function createClient(): Promise<DbClient | null> {
  if (!isAuthConfigured()) return null;
  const cookieStore = await cookies();
  return createServerClient(AUTH_URL, AUTH_ANON_KEY, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Called from a Server Component: cookies are read-only there. proxy.ts refreshes the session.
        }
      },
    },
  });
}

/** Service-role client (bypasses RLS). Server only; used by the agent to read a user's key. Null if not configured. */
export function createAdminClient(): DbClient | null {
  const serviceKey = process.env.UNFOLD_AUTH_SERVICE_KEY;
  if (!isAuthConfigured() || !serviceKey) return null;
  return createRawClient(AUTH_URL, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** The signed-in user (verified with the auth provider), the dev user when UNFOLD_DEV_NO_AUTH=1, else null. */
export async function getUser(): Promise<AppUser | null> {
  const db = await createClient();
  if (db) {
    const { data } = await db.auth.getUser();
    if (data.user) return { id: data.user.id, email: data.user.email ?? null };
  }
  if (isDevNoAuth()) return { ...DEV_USER, dev: true };
  return null;
}

/** For API route handlers: the user, or a 401 JSON Response to return as-is. */
export async function requireUser(): Promise<AppUser | Response> {
  const user = await getUser();
  if (user) return user;
  return Response.json(
    { error: "unauthorized", message: isAuthConfigured() ? "Sign in first." : "Sign-in is not configured." },
    { status: 401 },
  );
}
