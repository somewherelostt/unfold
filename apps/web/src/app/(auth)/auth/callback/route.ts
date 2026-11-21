import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { safeNext } from "@/lib/auth/env";
import { createClient } from "@/lib/auth/server";

/**
 * Magic-link landing. Handles both link styles from the auth provider:
 *  - PKCE: ?code=…            (default {{ .ConfirmationURL }} template)
 *  - token hash: ?token_hash=…&type=email
 */
export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const next = safeNext(url.searchParams.get("next"));
  const code = url.searchParams.get("code");
  const tokenHash = url.searchParams.get("token_hash");
  const type = (url.searchParams.get("type") ?? "email") as EmailOtpType;

  const db = await createClient();
  if (db) {
    const { error } = code
      ? await db.auth.exchangeCodeForSession(code)
      : tokenHash
        ? await db.auth.verifyOtp({ token_hash: tokenHash, type })
        : { error: new Error("missing code") };
    if (!error) return NextResponse.redirect(new URL(next, url.origin));
  }

  const fail = new URL("/login", url.origin);
  fail.searchParams.set("error", "link");
  fail.searchParams.set("next", next);
  return NextResponse.redirect(fail);
}
