import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { isDevNoAuth, isAuthConfigured, safeNext } from "@/lib/auth/env";
import { Logo, Notice } from "../_components/brand";
import { LoginForm } from "./login-form";
import { buttonClasses } from "@/components/ui/Button";
import "@/components/app/app.css";

export const metadata: Metadata = { title: "Sign in · Unfold" };

export default function LoginPage({ searchParams }: PageProps<"/login">) {
  return (
    <main className="uf-app uf-auth-page">
      <header className="uf-auth-header">
        <Logo />
        <Link href="/" className="uf-text-link">Back to home <span aria-hidden>↗</span></Link>
      </header>
      <div className="uf-auth-content">
        <div className="w-full max-w-[420px]">
          <p className="uf-kicker">Your workspace</p>
          <h1 className="uf-auth-title">
            Sign in to Unfold
          </h1>
          <p className="mt-3 text-[14px] leading-6 text-text-2">Keep your footage, edits and connections together.</p>
          <div className="uf-card mt-7">
            <Suspense fallback={<p role="status" className="text-[13px] text-text-3">Checking sign-in availability…</p>}>
              <LoginBody searchParams={searchParams} />
            </Suspense>
          </div>
        </div>
      </div>
    </main>
  );
}

async function LoginBody({ searchParams }: { searchParams: PageProps<"/login">["searchParams"] }) {
  const sp = await searchParams;
  const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const next = safeNext(first(sp.next));
  const error = first(sp.error);
  const configured = isAuthConfigured();

  if (!configured) return <div className="space-y-5">
    <Notice title="Sign-in is unavailable right now">{isDevNoAuth() ? "You can continue to the workspace without signing in." : "Please try again later to access your account."}</Notice>
    <Link href={isDevNoAuth() ? next : "/"} className={buttonClasses("secondary", "md", "w-full")}>{isDevNoAuth() ? "Continue to workspace" : "Back to home"}</Link>
  </div>;

  return (
    <div className="flex flex-col gap-4">
      {error ? (
        <Notice tone="error" title="That sign-in link didn't work">
          It may have expired or been used already. Send a new code below.
        </Notice>
      ) : null}
      <LoginForm next={next} />
      <p className="text-[12px] leading-5 text-text-3">We’ll email you a sign-in link and a 6-digit code. Signing in for the first time creates your account.</p>
    </div>
  );
}
