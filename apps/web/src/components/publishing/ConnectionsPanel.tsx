import { Button } from "@/components/ui/Button";
import { Panel } from "@/components/ui/Panel";
import type { AccountView, Platform } from "../../../../../services/publishing/src/types";
import type { Capability } from "../../../../../services/publishing/src/composio";
import { PlatformMark } from "./PlatformMark";
import { AccountAvatar } from "./AccountAvatar";

const names: Record<Platform, string> = { instagram: "Instagram", pinterest: "Pinterest", bluesky: "Bluesky" };
const permissions: Record<string, string> = { instagram_business_basic: "Read your Instagram profile", instagram_business_content_publish: "Publish photos and videos", "boards:read": "Read your boards", "pins:read": "Read your Pins", "pins:write": "Create and manage Pins", "user_accounts:read": "Read your Pinterest profile" };
type Props = {
  accounts: AccountView[];
  capabilities: Capability[];
  connectionReady: boolean;
  busy: string;
  hasPosts: boolean;
  onConnect: (platform: Platform, accountId?: string) => void;
  onCheck: (accountId: string) => void;
  onDisconnect: (account: AccountView) => void;
};

export function ConnectionsPanel({ accounts, capabilities, connectionReady, busy, hasPosts, onConnect, onCheck, onDisconnect }: Props) {
  return <section className="uf-publish-connections" aria-labelledby="publishing-connections-title">
    <div className="uf-publish-section-heading"><div><h2 id="publishing-connections-title">Your accounts. Ready for your next post.</h2><p className="uf-publish-muted">Choose where your finished videos go. Review access before you share.</p></div></div>
    <div className="uf-publish-account-grid">{capabilities.filter((cap) => cap.videoSupported || accounts.some((a) => a.platform === cap.platform)).map((cap) => {
      const platformAccounts = accounts.filter((a) => a.platform === cap.platform);
      // A capped post list cannot disprove older references: preserve attempts whenever history exists.
      const previousAttempts = hasPosts ? platformAccounts.filter((a) => a.status === "disconnected" && !a.identity) : [];
      const currentAccounts = platformAccounts.filter((a) => a.status !== "disconnected" || a.identity);
      const connected = platformAccounts.filter((a) => a.status === "connected").length;
      const connecting = currentAccounts.some((a) => a.status === "connecting");
      return <Panel className={`uf-card uf-publish-account-card uf-publish-channel-${cap.platform}`} key={cap.platform}>
        <header className="uf-publish-channel-header"><PlatformMark platform={cap.platform} large /><div><p className="uf-publish-channel-format">{cap.platform === "instagram" ? "REELS" : cap.platform === "pinterest" ? "VIDEO PINS" : "VIDEO"}</p><h3>{names[cap.platform]}</h3></div><span className={`uf-publish-channel-state ${connected ? "is-connected" : connecting ? "is-pending" : ""}`}>{connected ? `${connected} connected` : connecting ? "Connecting" : "Not connected"}</span></header>
        <p className="uf-publish-channel-description">{cap.platform === "instagram" ? "Share Reels from your Business or Creator account." : cap.platform === "pinterest" ? "Save video Pins to your boards, with a cover frame you choose." : "Video publishing is unavailable with this connection."}</p>
        <div className="uf-publish-channel-accounts">{currentAccounts.length ? currentAccounts.map((a) => <div className="uf-publish-account" key={a.id}>
          <div className="uf-publish-identity"><AccountAvatar account={a} /><div className="uf-publish-identity-copy"><strong>{a.identity ? `@${a.identity.handle}` : "Identity not verified"}</strong><p>{a.identity?.name && a.identity.name !== a.identity.handle ? a.identity.name : a.identity?.accountType === "MEDIA_CREATOR" || a.identity?.accountType === "CREATOR" ? "Creator account" : a.identity?.accountType === "BUSINESS" ? "Business account" : "Social account"}</p></div><span className={`uf-publish-status uf-publish-status-${a.status === "connected" ? "published" : a.status === "connecting" ? "processing" : a.status === "disconnected" ? "cancelled" : "unknown"}`}><span aria-hidden="true">{a.status === "connected" ? "✓" : a.status === "connecting" ? "◷" : "•"}</span>{a.status === "connected" ? "Connected" : a.status === "connecting" ? "Connecting" : a.status === "disconnected" ? "Disconnected" : "Reconnect needed"}</span></div>
          {a.status === "connecting" && <p className="uf-publish-account-hint">Finish sign-in and consent to verify this account.</p>}
          {a.status === "reconnect_required" && <p className="uf-publish-account-hint">Connect again to restore access for your posts.</p>}
          <details className="uf-publish-account-options"><summary>Permissions &amp; account options <span aria-hidden="true">⌄</span></summary><div><p>Requested permissions</p>{a.requestedScopes.length ? <ul>{a.requestedScopes.map((scope) => <li key={scope}>{permissions[scope] ?? scope}</li>)}</ul> : <p>Review the platform’s consent screen.</p>}<p>Publishing access is checked again before each post.</p>{a.verifiedAt && <p>Identity checked {new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(a.verifiedAt)}.</p>}{a.status !== "disconnected" && <Button variant="ghost" disabled={Boolean(busy)} onClick={() => onDisconnect(a)}>Disconnect account</Button>}</div></details>
          <div className="uf-publish-actions"><Button variant="ghost" disabled={Boolean(busy)} onClick={() => onCheck(a.id)}><span aria-hidden="true">↻</span>{busy === a.id ? "Checking…" : "Check status"}</Button>{a.status !== "connected" && <Button disabled={!cap.available || Boolean(busy)} onClick={() => onConnect(a.platform, a.id)}>Reconnect</Button>}</div>
        </div>) : <div className="uf-publish-no-account"><span aria-hidden="true">+</span><div><strong>No account connected</strong><p>Your account will appear here after you finish connecting.</p></div></div>}{previousAttempts.length > 0 && <details className="uf-publish-connection-history"><summary>Previous connection attempts <span>{previousAttempts.length}</span></summary>{previousAttempts.map((a) => <div key={a.id}><span>Unverified attempt · Disconnected</span><Button variant="ghost" disabled={!cap.available || Boolean(busy)} onClick={() => onConnect(a.platform, a.id)}>Try again</Button></div>)}</details>}</div>
        <footer className="uf-publish-channel-footer">{!cap.available && <p className="uf-publish-small">{cap.reason}</p>}{cap.platform === "pinterest" && <p className="uf-publish-small">Production posting requires Standard API access. Trial API access cannot create production Pins.</p>}<Button className="uf-publish-connect" aria-label={connected ? `Connect another ${names[cap.platform]} account` : undefined} disabled={!cap.available || !connectionReady || Boolean(busy)} onClick={() => onConnect(cap.platform)}>{busy === cap.platform ? "Opening connection…" : cap.platform === "bluesky" ? "Video connection unavailable" : connected ? "Connect another account" : `Connect ${names[cap.platform]}`}<span aria-hidden="true">{connected ? "+" : "↗"}</span></Button></footer>
      </Panel>;
    })}</div>
  </section>;
}
