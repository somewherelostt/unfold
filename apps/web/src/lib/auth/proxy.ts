import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { AUTH_ANON_KEY, AUTH_URL, isDevNoAuth, isProtectedPath, isAuthConfigured, safeNext } from "./env";

/** Refreshes the auth session cookie and redirects signed-out visitors away from protected paths. */
export async function updateSession(request: NextRequest): Promise<NextResponse> {
  const { pathname, search } = request.nextUrl;
  const protectedPath = isProtectedPath(pathname);

  if (!isAuthConfigured()) {
    if (protectedPath && !isDevNoAuth()) return redirectToLogin(request, pathname + search, "not-configured");
    return NextResponse.next({ request });
  }

  let response = NextResponse.next({ request });
  const refreshHeaders = new Headers();
  const db = createServerClient(AUTH_URL, AUTH_ANON_KEY, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        Object.entries(headers ?? {}).forEach(([k, v]) => {
          response.headers.set(k, v);
          refreshHeaders.set(k, v);
        });
      },
    },
  });

  // getClaims() verifies the JWT and refreshes it if needed. Do not run code between client creation and this call.
  const { data } = await db.auth.getClaims();
  const signedIn = Boolean(data?.claims?.sub);

  if (protectedPath && !signedIn && !isDevNoAuth()) {
    const redirect = redirectToLogin(request, pathname + search);
    return preserveSession(redirect, response, refreshHeaders);
  }
  if (pathname === "/login" && signedIn) {
    const next = request.nextUrl.searchParams.get("next");
    const url = new URL(safeNext(next), request.url);
    return preserveSession(NextResponse.redirect(url), response, refreshHeaders);
  }
  return response;
}

function preserveSession(redirect: NextResponse, session: NextResponse, headers: Headers) {
  session.cookies.getAll().forEach((cookie) => redirect.cookies.set(cookie));
  headers.forEach((value, name) => redirect.headers.set(name, value));
  return redirect;
}

function redirectToLogin(request: NextRequest, next: string, reason?: string) {
  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  url.searchParams.set("next", next);
  if (reason) url.searchParams.set("reason", reason);
  return NextResponse.redirect(url);
}
