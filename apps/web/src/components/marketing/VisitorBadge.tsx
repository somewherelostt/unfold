"use client";

import { useEffect, useState } from "react";

const STORAGE_KEY = "unfold:visitor:v1";
const VISITOR_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EXPLANATION = "Unique browsers with a saved first-party ID. Clearing site storage or using another browser counts again.";

export function VisitorBadge() {
  const [count, setCount] = useState<number | null>(null);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      let visitorId: string | null = null;
      if (window.location.origin === "https://unfold.maazx.dev") {
        try {
          const saved = window.localStorage.getItem(STORAGE_KEY);
          const id = saved && VISITOR_ID.test(saved) ? saved : window.crypto.randomUUID();
          window.localStorage.setItem(STORAGE_KEY, id);
          if (window.localStorage.getItem(STORAGE_KEY) === id) visitorId = id;
        } catch { /* Without persistent storage, read the total without adding a repeat visit. */ }
      }
      try {
        const response = await fetch("/api/visitors", {
          method: visitorId ? "POST" : "GET",
          ...(visitorId ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify({ visitorId }) } : {}),
          cache: "no-store",
          credentials: "same-origin",
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("Visitor count unavailable.");
        const data: unknown = await response.json();
        if (!data || typeof data !== "object" || !("count" in data) ||
            typeof data.count !== "number" || !Number.isSafeInteger(data.count) || data.count < 0) {
          throw new Error("Invalid visitor count.");
        }
        if (!controller.signal.aborted) setCount(data.count);
      } catch {
        if (!controller.signal.aborted) setUnavailable(true);
      }
    }
    void load();
    return () => controller.abort();
  }, []);

  return (
    <div
      className="mt-5 inline-flex h-8 w-[240px] shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-full border border-hairline bg-surface-2/60 px-3 text-xs text-text-3"
      role="status"
      title={unavailable ? "The visitor service is temporarily unavailable." : EXPLANATION}
    >
      <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
      <span>Visitors</span>
      <span className="tabular-nums text-text-2">{count === null ? (unavailable ? "unavailable" : "…") : count.toLocaleString("en-US")}</span>
    </div>
  );
}
