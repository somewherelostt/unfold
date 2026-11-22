"use client";
import { useActionState, useState } from "react";
import { sendCode, verifyCode, type LoginState } from "./actions";

const input =
  "uf-field h-11 w-full";
const primary =
  "inline-flex h-10 w-full items-center justify-center rounded-sm bg-primary-btn px-4 text-[13px] font-medium text-primary-btn-ink transition-opacity duration-[120ms] hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-text-3 focus-visible:ring-offset-2 focus-visible:ring-offset-bg disabled:opacity-50";

export function LoginForm({ next, disabled }: { next: string; disabled?: boolean }) {
  const [emailState, emailAction, sending] = useActionState<LoginState, FormData>(sendCode, { step: "email" });
  const [codeState, codeAction, verifying] = useActionState<LoginState, FormData>(verifyCode, { step: "email" });
  const [changeEmail, setChangeEmail] = useState(0);

  const onCode = emailState.step === "code" && changeEmail === 0;
  const email = emailState.email ?? "";

  if (onCode) {
    const err = codeState.error;
    return (
      <div className="flex flex-col gap-4">
        <p className="text-[13px] leading-5 text-text-2" role="status">
          {emailState.step === "code" ? emailState.info : null} Click the link, or enter the code here.
        </p>
        <form action={codeAction} className="flex flex-col gap-3">
          <input type="hidden" name="email" value={email} />
          <input type="hidden" name="next" value={next} />
          <label htmlFor="code" className="text-[12px] font-medium text-text-2">
            6-digit code
          </label>
          <input
            id="code"
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9 ]{6,12}"
            maxLength={12}
            required
            aria-invalid={!!err}
            aria-describedby={err ? "code-error" : undefined}
            autoFocus
            placeholder="123456"
            className={`${input} font-mono text-[20px] tracking-[0.3em] tabular`}
          />
          {err ? <p id="code-error" className="text-[13px] text-danger" role="alert">{err}</p> : null}
          <button type="submit" className={primary} disabled={verifying}>
            {verifying ? "Checking…" : "Sign in"}
          </button>
        </form>
        <div className="flex items-center justify-between text-[13px]">
          <button type="button" className="text-text-2 underline-offset-4 hover:text-text-1 hover:underline" onClick={() => setChangeEmail((n) => n + 1)}>
            Use a different email
          </button>
          <form action={emailAction}>
            <input type="hidden" name="email" value={email} />
            <input type="hidden" name="next" value={next} />
            <button type="submit" disabled={sending} className="text-text-2 underline-offset-4 hover:text-text-1 hover:underline">
              {sending ? "Sending…" : "Resend code"}
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <form action={(fd) => { setChangeEmail(0); return emailAction(fd); }} className="flex flex-col gap-3">
      <input type="hidden" name="next" value={next} />
      <label htmlFor="email" className="text-[12px] font-medium text-text-2">
        Email
      </label>
      <input
        id="email"
        name="email"
        type="email"
        autoComplete="email"
        required
        aria-invalid={emailState.step === "email" && !!emailState.error}
        aria-describedby={emailState.step === "email" && emailState.error ? "email-error" : undefined}
        autoFocus
        defaultValue={email}
        placeholder="you@studio.com"
        className={input}
        disabled={disabled}
      />
      {emailState.step === "email" && emailState.error ? (
        <p id="email-error" className="text-[13px] text-danger" role="alert">{emailState.error}</p>
      ) : null}
      <button type="submit" className={primary} disabled={sending || disabled}>
        {sending ? "Sending…" : "Email me a sign-in code"}
      </button>
    </form>
  );
}
