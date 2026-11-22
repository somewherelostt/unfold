import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { isDevNoAuth, isAuthConfigured, safeNext } from "@/lib/auth/env";
import { Logo, Notice } from "../_components/brand";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in · Unfold" };

export default function LoginPage({ searchParams }: PageProps<"/login">) {
  return (
    <main className="relative flex flex-1 flex-col bg-bg text-text-1">
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-[480px] opacity-40 [background:var(--glow-hero)]" />
      <header className="relative mx-auto flex w-full max-w-6xl items-center px-4 py-5 sm:px-6">
        <Logo />
      </header>
      <div className="relative flex flex-1 items-start justify-center px-4 pb-16 pt-10 sm:items-center sm:pt-0">
        <div className="relative w-full max-w-[400px]">
          <p className="mb-3 font-mono text-[11px] text-text-3">Your editing agent</p>
          <h1 className="font-display text-[40px] font-normal leading-[44px] tracking-[-0.02em] text-text-1">
            Sign in to Unfold
          </h1>
          <p className="mt-3 text-[15px] leading-6 text-text-2">Turn your raw clip into a finished edit, with captions, music and a hook.</p>
          <div className="mt-8 rounded-lg border border-hairline bg-surface-1 p-6 shadow-raised">
            <Suspense fallback={<div className="h-[132px]" />}>
              <LoginBody searchParams={searchParams} />
            </Suspense>
          </div>
          <p className="mt-6 text-[13px] leading-5 text-text-2">
            No password. We email you a link and a 6-digit code. New here? Signing in creates your account.{" "}
            <Link href="/" className="text-text-1 underline-offset-4 hover:underline">Back to home</Link>
          </p>
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

  return (
    <div className="flex flex-col gap-4">
      {!configured ? (
        <Notice tone="warn" title="Sign-in is off in this build">
          The auth provider isn&apos;t connected.
          {isDevNoAuth() ? (
            <>
              {" "}Demo mode is on, so you can{" "}
              <Link href={next} className="font-medium text-text-1 underline underline-offset-4">continue without signing in</Link>.
            </>
          ) : (
            <> For local demos, set <code className="font-mono">UNFOLD_DEV_NO_AUTH=1</code>.</>
          )}
        </Notice>
      ) : null}
      {error ? (
        <Notice tone="error" title="That sign-in link didn't work">
          It may have expired or been used already. Send a new code below.
        </Notice>
      ) : null}
      <LoginForm next={next} disabled={!configured} />
    </div>
  );
}
