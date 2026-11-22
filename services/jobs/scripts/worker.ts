import { pathToFileURL } from "node:url";
import { loadJobConfig, type RuntimeConfig } from "../src/config.ts";
import { checkReadiness } from "../src/health.ts";
import { cleanExpiredResources } from "../src/retention.ts";
import { verifyRecordedExecutionStopped } from "../src/process.ts";
import { JobStore } from "../src/store.ts";
import { JobWorker, type JobHandler } from "../src/worker.ts";
import type { JobKind } from "../src/types.ts";

const config = loadJobConfig();
if (!config.bindingsModule) throw new Error("Set UNFOLD_JOB_BINDINGS to an owner-bound handler module before starting a worker.");
const store = new JobStore(config);
const shutdown = new AbortController();
process.once("SIGTERM", () => shutdown.abort());
process.once("SIGINT", () => shutdown.abort());
try {
  const readiness = await checkReadiness(config, store);
  if (!readiness.ready) { console.error(JSON.stringify(readiness)); process.exitCode = 1; }
  else {
    const binding = await import(pathToFileURL(config.bindingsModule).href) as { createHandlers: (runtime: RuntimeConfig) => Promise<Partial<Record<JobKind, JobHandler>>> };
    if (typeof binding.createHandlers !== "function") throw new Error("Bindings must export createHandlers(config).");
    const worker = new JobWorker(store, { handlers: await binding.createHandlers(config), verifyInterruptedExecutionStopped: (claim) => verifyRecordedExecutionStopped(store, claim), onError: () => console.error("Worker transition failed; inspect job storage and recover interrupted work before restarting.") });
    const cleanup = setInterval(() => { void cleanExpiredResources(store).catch(() => console.error("Scratch retention failed.")); }, 60_000);
    try { await worker.run(shutdown.signal); }
    finally { clearInterval(cleanup); await worker.stop(); }
  }
} finally { store.close(); }
