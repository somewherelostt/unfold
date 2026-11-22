import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Logo, Notice } from "../../(auth)/_components/brand";
import { SignOutButton } from "../../(auth)/_components/sign-out-button";
import { isEncryptionConfigured } from "@/lib/crypto";
import { listUserKeys } from "@/lib/auth/api-keys";
import { isDevNoAuth, isAuthConfigured } from "@/lib/auth/env";
import { PROVIDERS, PROVIDER_IDS } from "@/lib/auth/providers";
import { getUser } from "@/lib/auth/server";
import { redirect } from "next/navigation";
import { KeyCard } from "./key-card";

export const metadata: Metadata = { title: "Settings · Unfold" };

export default function SettingsPage() {
  return (
    <main className="flex flex-1 flex-col bg-bg text-text-1">
      <header className="border-b border-hairline bg-surface-1">
        <div className="mx-auto flex w-full max-w-3xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <Logo href="/app" />
          <Suspense fallback={<div className="h-9 w-40" />}>
            <Account />
          </Suspense>
        </div>
      </header>
      <div className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6 sm:py-14">
        <Link href="/app" className="text-[13px] text-text-2 underline-offset-4 hover:text-text-1 hover:underline">← Back to editor</Link>
        <h1 className="mt-4 font-display text-[40px] font-normal leading-[44px] tracking-[-0.02em] text-text-1">API keys</h1>
        <p className="mt-3 max-w-xl text-[13px] leading-5 text-text-2">
          Check your Cerebras key and keep it encrypted in your account. Only the last four characters are shown after saving.
        </p>
        <div className="mt-8">
          <Suspense fallback={<KeysSkeleton />}>
            <Keys />
          </Suspense>
        </div>
      </div>
    </main>
  );
}

async function Account() {
  const user = await getUser();
  if (!user) return null;
  return (
    <div className="flex min-w-0 items-center gap-3">
      <span className="hidden truncate text-[13px] text-text-2 sm:inline">
        {user.email}
        {user.dev ? <span className="ml-2 rounded-full bg-surface-3 px-2 py-0.5 text-[11px] font-medium text-text-2">Demo mode</span> : null}
      </span>
      {!user.dev ? <SignOutButton /> : null}
    </div>
  );
}

async function Keys() {
  const user = await getUser();
  if (!user) redirect("/login?next=/settings");

  const authOk = isAuthConfigured();
  const encOk = isEncryptionConfigured();
  const devMemory = !authOk && isDevNoAuth();
  let stored: Awaited<ReturnType<typeof listUserKeys>> = [];
  let loadError: string | null = null;
  try {
    stored = await listUserKeys(user.id);
  } catch (err) {
    loadError = (err as Error).message;
  }
  const byProvider = new Map(stored.map((k) => [k.provider, k.last4]));
  const canSave = (authOk || devMemory) && (encOk || devMemory);

  return (
    <div className="flex flex-col gap-4">
      <Notice title="Editing connection">
        {user.dev
          ? "Local demo edits use the server-funded OpenClaw connection. Saved keys here are used only for the key check."
          : "Your saved Cerebras key runs your edits in an isolated OpenClaw connection. Add a key before generating an edit."}
      </Notice>
      {devMemory ? (
        <Notice tone="warn" title="Local demo mode">
          Keys stay encrypted in server memory for this session only{encOk ? "" : " (with a throwaway encryption key)"}. Connect a database to keep them.
        </Notice>
      ) : null}
      {!authOk && !devMemory ? (
        <Notice tone="warn" title="Database not connected">Keys can&apos;t be saved until a database is connected.</Notice>
      ) : null}
      {authOk && !encOk ? (
        <Notice tone="error" title="Encryption key missing">
          Set <code className="font-mono">UNFOLD_ENCRYPTION_KEY</code> (64 hex chars) on the server before saving keys.
        </Notice>
      ) : null}
      {loadError ? <Notice tone="error" title="Couldn't load your keys">{loadError}</Notice> : null}
      {PROVIDER_IDS.map((id) => {
        const meta = PROVIDERS[id];
        return (
          <KeyCard
            key={id}
            provider={id}
            label={meta.label}
            description={meta.description}
            placeholder={meta.placeholder}
            docsUrl={meta.docsUrl}
            required={id === "cerebras" && !user.dev}
            testable={meta.testable}
            model={id === "cerebras" ? "Kimi K3.1 Pro" : undefined}
            last4={byProvider.get(id) ?? null}
            disabled={!canSave}
          />
        );
      })}
    </div>
  );
}

function KeysSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-hidden>
      {PROVIDER_IDS.map((id) => (
        <div key={id} className="h-[148px] animate-pulse rounded-lg border border-hairline bg-surface-1" />
      ))}
    </div>
  );
}
