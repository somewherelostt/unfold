import Link from "next/link";
import { BrandLogo } from "@/components/ui/BrandLogo";

/** Shared vector wordmark follows the page's ink color. */
export function Logo({ href = "/" }: { href?: string }) {
  return (
    <Link href={href} className="inline-flex items-center text-text-1" aria-label="Unfold home">
      <BrandLogo width={148} height={36} />
    </Link>
  );
}

export function Notice({ tone = "info", title, children }: { tone?: "info" | "warn" | "error" | "success"; title: string; children?: React.ReactNode }) {
  const color = {
    info: "border-hairline-strong bg-surface-2",
    warn: "border-accent/20 bg-accent/5",
    error: "border-danger/20 bg-danger/5",
    success: "border-success/20 bg-success/5",
  }[tone];
  return (
    <div role={tone === "error" ? "alert" : "status"} className={`rounded-md border px-4 py-3 text-[13px] leading-5 text-text-1 ${color}`}>
      <p className="font-medium">{title}</p>
      {children ? <div className="mt-1 text-text-2">{children}</div> : null}
    </div>
  );
}
