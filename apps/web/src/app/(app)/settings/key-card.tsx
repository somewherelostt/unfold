"use client";
import { useActionState, useState, useTransition } from "react";
import { removeKey, saveKey, testCerebrasKey, type SaveState, type TestResult } from "./actions";
import type { Provider } from "@/lib/auth/providers";
import { Button } from "@/components/ui/Button";

type Props = {
  provider: Provider; label: string; description: string; placeholder: string; docsUrl: string | null;
  required: boolean; testable: boolean; model?: string; last4: string | null; disabled?: boolean;
  actions?: { save: boolean; check: boolean; replace: boolean; remove: boolean };
  unavailable?: boolean;
};

/** Saved credentials and a successful live check are deliberately separate states. */
export function KeyCard(p: Props) {
  const [state, action, saving] = useActionState<SaveState, FormData>(saveKey, {});
  const [editing, setEditing] = useState<boolean | null>(null);
  const [seenState, setSeenState] = useState(state);
  if (state !== seenState) { setSeenState(state); if (state.ok) setEditing(null); }
  const [test, setTest] = useState<TestResult | null>(null);
  const [testing, startTest] = useTransition();
  const [removing, startRemove] = useTransition();
  const [removeError, setRemoveError] = useState<string | null>(null);
  const connected = Boolean(p.last4);
  const showForm = editing ?? !connected;
  const allowed = p.actions ?? { save: !p.disabled, check: p.testable && !p.disabled, replace: !p.disabled, remove: !p.disabled };
  const canSubmit = connected ? allowed.replace : allowed.save;
  const status = testing ? "Checking…" : saving ? "Saving…" : removing ? "Removing…" : p.unavailable ? "Unavailable" : test ? test.ok ? "Access verified" : "Needs attention" : connected ? "Key saved" : "Not connected";
  return <section className="uf-card uf-connection-card" aria-labelledby="editing-connection-title" aria-busy={saving || testing || removing}>
    <div className="uf-settings-card-head">
      <div><p className="uf-kicker">Editing connection</p><h2 id="editing-connection-title">{p.label}</h2></div>
      <span className="uf-connection-status" data-tone={test?.ok ? "success" : test ? "error" : "neutral"}><span aria-hidden />{status}</span>
    </div>
    <p className="uf-settings-copy">{p.description}</p>
    {p.model && <p className="uf-connection-model">{p.model}</p>}
    {connected && !showForm && <div className="uf-connection-controls">
      <span className="uf-masked-key">•••• {p.last4}</span>
      {allowed.check && <Button variant="secondary" disabled={testing || removing} onClick={() => startTest(async () => setTest(await testCerebrasKey()))}>{testing ? "Checking…" : "Check connection"}</Button>}
      {allowed.replace && <Button variant="ghost" disabled={testing || removing} onClick={() => setEditing(true)}>Replace key</Button>}
      {allowed.remove && <Button variant="ghost" disabled={testing || removing} onClick={() => startRemove(async () => { const result = await removeKey(p.provider); setRemoveError(result.error ?? null); setTest(null); if (result.ok) setEditing(null); })}>{removing ? "Removing…" : "Remove"}</Button>}
    </div>}
    {showForm && canSubmit && <form action={async (form) => { await action(form); }} className="uf-key-form" onSubmit={() => setTest(null)}>
      <input type="hidden" name="provider" value={p.provider} />
      <label htmlFor={`key-${p.provider}`}>{p.label} API key</label>
      <div className="uf-key-input-row"><input id={`key-${p.provider}`} name="key" type="password" autoComplete="off" spellCheck={false} required placeholder={p.placeholder} disabled={saving} aria-invalid={Boolean(state.error)} aria-describedby={state.error ? `key-error-${p.provider}` : `key-help-${p.provider}`} className="uf-field min-w-0 flex-1" /><Button type="submit" variant="primary" disabled={saving}>{saving ? "Saving…" : "Save key"}</Button>{connected && <Button variant="ghost" disabled={saving} onClick={() => setEditing(null)}>Cancel</Button>}</div>
      <p id={`key-help-${p.provider}`} className="uf-settings-help">Your key stays hidden after saving. Only its last four characters are shown.</p>
    </form>}
    {connected && !test && !showForm && <p className="uf-settings-help mt-3">{p.unavailable ? "You can remove the saved key. Adding or checking a connection is currently unavailable." : "Saved to your account. Check the connection to verify access."}</p>}
    {state.error && <p id={`key-error-${p.provider}`} className="uf-settings-error" role="alert">{state.error}</p>}
    {state.ok && !saving && connected && !showForm && <p className="uf-settings-help mt-3" role="status">Key saved. You can check the connection now.</p>}
    {removeError && <p className="uf-settings-error" role="alert">{removeError}</p>}
    {test && <div className="uf-status-card mt-4" role={test.ok ? "status" : "alert"} data-tone={test.ok ? "success" : "error"}><p>{test.message}</p>{typeof test.ms === "number" && <span className="font-mono text-[11px]">{test.ms} ms</span>}</div>}
    {p.docsUrl && <a href={p.docsUrl} target="_blank" rel="noreferrer" className="uf-settings-doc-link">Get a Cerebras API key <span aria-hidden>↗</span></a>}
  </section>;
}
