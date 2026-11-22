import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { AppHeader } from "@/components/app/AppHeader";
import { buttonClasses } from "@/components/ui/Button";
import { SignOutButton } from "../../(auth)/_components/sign-out-button";
import { getSettingsView } from "@/lib/auth/settings-view";
import { KeyCard } from "./key-card";
import "@/components/app/app.css";

export const metadata: Metadata = { title: "Settings · Unfold" };

export default function SettingsPage() {
  return <div className="uf-app min-h-dvh bg-bg text-text-1">
    <AppHeader />
    <main className="uf-page uf-settings-page">
      <header className="uf-page-heading"><div><p className="uf-kicker">Your workspace</p><h1>Settings</h1><p className="uf-page-description">Your account and the connection behind your edits.</p></div><Link href="/app" className="uf-text-link">Back to edits <span aria-hidden>↗</span></Link></header>
      <div className="uf-settings-layout">
        <nav aria-label="Settings sections" className="uf-settings-nav"><a href="#account">Account</a><a href="#editing-connection">Editing connection</a><Link href="/app/publishing">Publishing accounts <span aria-hidden>↗</span></Link></nav>
        <div className="uf-settings-sections"><Suspense fallback={<SettingsSkeleton />}><SettingsBody /></Suspense></div>
      </div>
    </main>
  </div>;
}

async function SettingsBody() {
  const { account, cerebras } = await getSettingsView();
  return <>
    <section className="uf-card" id="account" aria-labelledby="account-title">
      <div className="uf-settings-card-head"><div><p className="uf-kicker">Account</p><h2 id="account-title">{account.state === "signed_in" ? "Your account" : "Your workspace"}</h2></div><span className="uf-connection-status" data-tone="neutral"><span aria-hidden />{account.state === "signed_in" ? "Signed in" : "Not signed in"}</span></div>
      {account.state === "signed_in" ? <div className="uf-settings-account-row"><div><p className="text-[14px] text-text-1">{account.email}</p><p className="uf-settings-help">Your editing connection belongs to this account.</p></div>{account.canSignOut && <SignOutButton />}</div> : <div><p className="uf-settings-copy">{account.state === "unavailable" ? "Account sign-in is currently unavailable in this workspace." : "Sign in to manage the editing connection for your account."}</p>{account.signInHref && <Link href={account.signInHref} className={buttonClasses("primary", "md", "mt-4")}>Sign in</Link>}</div>}
    </section>
    <div id="editing-connection">
      {cerebras.state === "saved" || cerebras.state === "not_connected" || cerebras.actions.remove ? <KeyCard provider="cerebras" label="Cerebras" description="Connect your key to make and refine edits with Kimi." placeholder="csk-…" docsUrl="https://cloud.cerebras.ai" required testable model="Kimi on Cerebras" last4={cerebras.last4} actions={cerebras.actions} unavailable={cerebras.state === "unavailable"} /> : <section className="uf-card uf-connection-card" aria-labelledby="connection-unavailable-title">
        <div className="uf-settings-card-head"><div><p className="uf-kicker">Editing connection</p><h2 id="connection-unavailable-title">Cerebras</h2></div><span className="uf-connection-status" data-tone="neutral"><span aria-hidden />{cerebras.state === "account_required" ? "Sign-in required" : "Unavailable"}</span></div>
        <p className="uf-settings-copy">{cerebras.state === "account_required" ? "Sign in before adding a personal editing connection." : "Personal editing connections aren’t available in this workspace right now."}</p>
        <p className="uf-connection-model">Kimi on Cerebras</p>
        {cerebras.state === "account_required" && account.signInHref ? <Link href={account.signInHref} className={buttonClasses("primary", "md", "mt-5")}>Sign in to connect</Link> : <Link href="/app" className={buttonClasses("secondary", "md", "mt-5")}>Back to your edits</Link>}
      </section>}
    </div>
    <section className="uf-settings-note" aria-label="Publishing connections"><h2>Ready to share?</h2><p>Manage your publishing accounts in the publishing workspace.</p><Link href="/app/publishing" className="uf-text-link">Open publishing <span aria-hidden>↗</span></Link></section>
  </>;
}

function SettingsSkeleton() {
  return <div role="status" aria-busy="true" className="space-y-4"><span className="sr-only">Loading your settings…</span><div className="uf-card h-44 motion-safe:animate-pulse" /><div className="uf-card h-64 motion-safe:animate-pulse" /></div>;
}
