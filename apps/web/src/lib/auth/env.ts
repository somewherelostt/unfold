/** Environment checks shared by server, proxy and pages. Safe to import anywhere (no secrets read client-side). */

export const AUTH_URL = process.env.NEXT_PUBLIC_UNFOLD_AUTH_URL ?? "";
export const AUTH_ANON_KEY = process.env.NEXT_PUBLIC_UNFOLD_AUTH_ANON_KEY ?? "";

/** True once the auth provider URL and public key env vars are set. */
export function isAuthConfigured(): boolean {
  return AUTH_URL.length > 0 && AUTH_ANON_KEY.length > 0;
}

/** Dev bypass: UNFOLD_DEV_NO_AUTH=1 skips sign-in and acts as a fixed local user. Never on in production. */
export function isDevNoAuth(): boolean {
  return process.env.UNFOLD_DEV_NO_AUTH === "1" && process.env.NODE_ENV !== "production";
}

export const DEV_USER = {
  id: "00000000-0000-0000-0000-000000000000",
  email: "dev@unfold.local",
} as const;

/** Paths that require a signed-in user. Landing `/`, `/login`, `/auth/*` stay public. */
export const PROTECTED_PREFIXES = ["/app", "/settings"] as const;

export function isProtectedPath(pathname: string): boolean {
  return PROTECTED_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/** Only allow same-site relative redirects (prevents open redirects via ?next=). */
export function safeNext(next: string | null | undefined, fallback = "/app"): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return fallback;
  return next;
}
