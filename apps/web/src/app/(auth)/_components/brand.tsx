import Link from "next/link";

/** Mark + lowercase wordmark. Wordmark is live text so it follows the ink token in dark mode. */
export function Logo({ href = "/" }: { href?: string }) {
  return (
    <Link href={href} className="inline-flex items-center gap-2" aria-label="Unfold home">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/logo-mark.svg" alt="" width={28} height={28} className="h-7 w-7" />
      <span className="font-display text-[26px] font-extrabold leading-none tracking-[-0.03em] text-ink">unfold</span>
    </Link>
  );
}

export function Notice({ tone = "info", title, children }: { tone?: "info" | "warn" | "error" | "success"; title: string; children?: React.ReactNode }) {
  const color = {
    info: "border-violet/30 bg-violet/10",
    warn: "border-flare/30 bg-flare/10",
    error: "border-danger/30 bg-danger/10",
    success: "border-success/30 bg-success/10",
  }[tone];
  return (
    <div role={tone === "error" ? "alert" : "status"} className={`rounded-md border px-4 py-3 text-[13px] leading-5 text-ink ${color}`}>
      <p className="font-semibold">{title}</p>
      {children ? <div className="mt-1 text-ink-muted">{children}</div> : null}
    </div>
  );
}
