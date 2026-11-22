"use client";
import { useActionState, useState, useTransition } from "react";
import { removeKey, saveKey, testCerebrasKey, type SaveState, type TestResult } from "./actions";
import type { Provider } from "@/lib/auth/providers";

type Props = {
  provider: Provider;
  label: string;
  description: string;
  placeholder: string;
  docsUrl: string | null;
  required: boolean;
  testable: boolean;
  model?: string;
  last4: string | null;
  disabled?: boolean;
};

const btn = "inline-flex h-9 items-center justify-center rounded-sm px-3 text-[13px] font-medium transition-[opacity,background-color] duration-[120ms] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-text-3 disabled:opacity-50";
const primary = `${btn} bg-primary-btn text-primary-btn-ink hover:opacity-90`;
const secondary = `${btn} border border-hairline-strong bg-surface-2 text-text-1 hover:bg-surface-3`;

export function KeyCard(p: Props) {
  const [state, action, saving] = useActionState<SaveState, FormData>(saveKey, {});
  // null = automatic (form shown only when no key is connected); true = user clicked Replace.
  const [editing, setEditing] = useState<boolean | null>(null);
  const [seenState, setSeenState] = useState(state);
  if (state !== seenState) {
    setSeenState(state);
    if (state.ok) setEditing(null);
  }
  const [test, setTest] = useState<TestResult | null>(null);
  const [testing, startTest] = useTransition();
  const [removing, startRemove] = useTransition();
  const [removeError, setRemoveError] = useState<string | null>(null);

  const connected = Boolean(p.last4);
  const showForm = editing ?? !connected;

  return (
    <section className="rounded-lg border border-hairline bg-surface-1 p-5 shadow-raised sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-[18px] font-medium leading-6 tracking-[-0.005em] text-text-1">{p.label}</h2>
            {p.required ? (
              <span className="rounded-full bg-surface-3 px-2 py-0.5 text-[11px] font-medium text-text-2">Required</span>
            ) : (
              <span className="rounded-full bg-surface-3 px-2 py-0.5 text-[11px] font-medium text-text-2">Optional</span>
            )}
          </div>
          <p className="mt-1 text-[13px] leading-5 text-text-2">{p.description}</p>
          {p.model ? (
            <p className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-surface-3 px-2.5 py-1 font-mono text-[11px] text-text-2">
              {p.model}
            </p>
          ) : null}
        </div>
        {p.docsUrl ? (
          <a href={p.docsUrl} target="_blank" rel="noreferrer" className="text-[13px] text-text-2 underline-offset-4 hover:text-text-1 hover:underline">
          Get a key ↗
        </a>
        ) : null}
      </div>

      {connected && !showForm ? (
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <span className="inline-flex h-9 items-center gap-2 rounded-sm border border-hairline-strong bg-surface-2 px-3 font-mono text-[13px] text-text-1 tabular">
            <span className="h-2 w-2 rounded-full bg-success" aria-hidden />
            ••••{p.last4}
          </span>
          {p.testable ? (
            <button type="button" className={secondary} disabled={testing || p.disabled} onClick={() => startTest(async () => setTest(await testCerebrasKey()))}>
              {testing ? "Testing…" : "Test key"}
            </button>
          ) : null}
          <button type="button" className={secondary} onClick={() => setEditing(true)} disabled={p.disabled}>
            Replace
          </button>
          <button
            type="button"
            className={`${btn} text-text-2 hover:text-danger`}
            disabled={removing || p.disabled}
            onClick={() =>
              startRemove(async () => {
                const r = await removeKey(p.provider);
                setRemoveError(r.error ?? null);
                setTest(null);
                if (r.ok) setEditing(null);
              })
            }
          >
            {removing ? "Removing…" : "Remove"}
          </button>
        </div>
      ) : null}

      {showForm ? (
        <form
          action={async (fd) => {
            await action(fd);
          }}
          className="mt-5 flex flex-col gap-3 sm:flex-row"
          onSubmit={() => setTest(null)}
        >
          <input type="hidden" name="provider" value={p.provider} />
          <label htmlFor={`key-${p.provider}`} className="sr-only">{p.label} API key</label>
          <input
            id={`key-${p.provider}`}
            name="key"
            type="password"
            autoComplete="off"
            spellCheck={false}
            required
            placeholder={p.placeholder}
            disabled={p.disabled}
            className="h-9 min-w-0 flex-1 rounded-sm border border-hairline-strong bg-surface-2 px-3 font-mono text-[13px] text-text-1 placeholder:font-sans placeholder:text-text-3 outline-none transition-[border-color,box-shadow] duration-[120ms] focus:border-text-3 focus:ring-2 focus:ring-text-3/20 disabled:opacity-50"
          />
          <div className="flex gap-2">
            <button type="submit" className={primary} disabled={saving || p.disabled}>
              {saving ? "Saving…" : "Save key"}
            </button>
            {connected ? (
              <button type="button" className={secondary} onClick={() => setEditing(null)}>Cancel</button>
            ) : null}
          </div>
        </form>
      ) : null}

      {state.error ? <p className="mt-3 text-[13px] text-danger" role="alert">{state.error}</p> : null}
      {state.ok && !saving && state.last4 && connected && !showForm ? (
        <p className="mt-3 text-[13px] text-success" role="status">Saved. Encrypted and stored. Only ••••{state.last4} is ever shown.</p>
      ) : null}
      {removeError ? <p className="mt-3 text-[13px] text-danger" role="alert">{removeError}</p> : null}
      {test ? (
        <p className={`mt-3 text-[13px] ${test.ok ? "text-success" : "text-danger"}`} role="status">
          {test.ok ? "✓ " : "✕ "}
          {test.message}
          {typeof test.ms === "number" ? <span className="ml-2 font-mono text-text-2 tabular">{test.ms}ms</span> : null}
        </p>
      ) : null}
    </section>
  );
}
