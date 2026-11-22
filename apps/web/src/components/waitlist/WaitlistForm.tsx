"use client";

import { useState, type FormEvent } from "react";
import { buttonClasses } from "@/components/ui/Button";

export function WaitlistForm() {
  const [state, setState] = useState<"idle" | "sending" | "joined">("idle");
  const [error, setError] = useState("");
  async function join(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (state === "sending") return;
    const fields = new FormData(event.currentTarget);
    setState("sending"); setError("");
    try {
      const response = await fetch("/api/waitlist", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: fields.get("email"), website: fields.get("website") ?? "" }) });
      const data = await response.json();
      if (!response.ok || data.joined !== true) {
        setError(response.status === 429 ? "Too many requests. Please try again in an hour." : response.status === 400 ? "Enter a valid email address." : "We couldn’t save your email. Please try again shortly.");
        setState("idle"); return;
      }
      setState("joined");
    } catch { setError("We couldn’t connect. Check your connection and try again."); setState("idle"); }
  }
  if (state === "joined") return <div role="status" className="py-3">
    <p className="text-[20px] font-medium tracking-tight">You’re on the list.</p>
    <p className="mt-2 text-[14px] leading-6 text-text-2">We’ll let you know when hosted Unfold opens to everyone. Until then, you can run it yourself from GitHub.</p>
  </div>;
  return <form onSubmit={join} className="flex flex-col gap-3">
    <label htmlFor="waitlist-email" className="text-[13px] font-medium">Email address</label>
    <input id="waitlist-email" type="email" name="email" autoComplete="email" required maxLength={254}
      placeholder="you@studio.com" disabled={state === "sending"} className="uf-field h-12 w-full"
      aria-invalid={!!error} aria-describedby={error ? "waitlist-error" : "waitlist-privacy"} />
    <div className="sr-only" aria-hidden="true"><label htmlFor="waitlist-website">Website</label>
      <input id="waitlist-website" name="website" type="text" tabIndex={-1} autoComplete="off" /></div>
    <button className={buttonClasses("primary", "lg", "w-full")} disabled={state === "sending"}>
      {state === "sending" ? "Joining…" : "Join waitlist"}
    </button>
    {error ? <p id="waitlist-error" role="alert" className="text-[13px] leading-5 text-danger">{error}</p> : null}
    <p id="waitlist-privacy" className="mt-1 text-[12px] leading-5 text-text-3">Your email will only be used for Unfold launch updates. No account or sign-in code needed.</p>
  </form>;
}
