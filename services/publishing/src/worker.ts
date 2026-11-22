import { randomUUID } from "node:crypto";
import { Publisher } from "./dispatch.ts";
import { PublishingStore } from "./store.ts";

/** Run as a supervised long-lived process on the same persistent volume as the web app. */
export async function runPublishingWorker(store: PublishingStore, publisher: Publisher, signal: AbortSignal) {
  const id = randomUUID(), tasks = new Set<Promise<void>>();
  const heartbeat = setInterval(() => store.heartbeat(id), 10_000); heartbeat.unref(); store.heartbeat(id);
  try {
    while (!signal.aborted) {
      const claim = tasks.size < 2 ? store.claim() : null;
      if (!claim) { await new Promise<void>((resolve) => { const onAbort = () => { clearTimeout(timer); resolve(); }; const timer = setTimeout(() => { signal.removeEventListener("abort", onAbort); resolve(); }, 500); signal.addEventListener("abort", onAbort, { once: true }); }); continue; }
      const renew = setInterval(() => { try { store.renew(claim.destination.id, claim.token); } catch { clearInterval(renew); } }, 30_000); renew.unref();
      const task = publisher.dispatch(claim).catch(() => { /* No raw provider errors or request bodies in logs. Expired fences reconcile durably. */ }).finally(() => { clearInterval(renew); tasks.delete(task); }); tasks.add(task);
    }
    // Finish in-flight requests. Abrupt process death is recovered through the operation ledger.
    await Promise.allSettled(tasks);
  } finally { clearInterval(heartbeat); }
}
