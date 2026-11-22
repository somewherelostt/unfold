/** Real-handler harness: requires owner-bound storage bindings; it contains no stand-in media handler. */
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { loadJobConfig, type RuntimeConfig } from "../src/config.ts";
import { checkReadiness } from "../src/health.ts";
import { JobStore } from "../src/store.ts";
import { parseClientJobRequest } from "../src/transport.ts";
import { isTerminal, type JobContext, type JobKind } from "../src/types.ts";
import { JobWorker, type JobHandler } from "../src/worker.ts";
import { setTimeout as delay } from "node:timers/promises";

const file = process.argv[2];
if (!file) throw new Error("Usage: node services/jobs/scripts/integration.ts /absolute/operator-request.json");
const config = loadJobConfig();
if (!config.bindingsModule) throw new Error("Real integration is not configured: set UNFOLD_JOB_BINDINGS to the owner-bound media handler module.");
const operatorRequest = JSON.parse(await readFile(file, "utf8")) as JobContext & { request: unknown };
const context = { ownerId: operatorRequest.ownerId, projectId: operatorRequest.projectId };
const request = parseClientJobRequest(operatorRequest.request);
const store = new JobStore(config);
let worker: JobWorker | null = null;
const shutdown = new AbortController();
process.once("SIGINT", () => shutdown.abort()); process.once("SIGTERM", () => shutdown.abort());
try {
  const readiness = await checkReadiness(config, store);
  if (!readiness.ready) throw new Error(`Worker is not ready: ${JSON.stringify(readiness)}`);
  const bindings = await import(pathToFileURL(config.bindingsModule).href) as { createHandlers: (runtime: RuntimeConfig) => Promise<Partial<Record<JobKind, JobHandler>>>; authorizeInput: (ctx: JobContext, input: typeof request.input) => Promise<void> };
  if (typeof bindings.authorizeInput !== "function") throw new Error("Integration bindings must authorize operator input ownership before enqueueing.");
  await bindings.authorizeInput(context, request.input);
  const queued = store.enqueue(context, request);
  console.log(JSON.stringify({ created: queued.created, job: queued.job }));
  worker = new JobWorker(store, { handlers: await bindings.createHandlers(config), onError: () => console.error("Worker state transition failed.") });
  let revision = queued.job.revision;
  while (!shutdown.signal.aborted) {
    worker.tick();
    const job = store.get(context, queued.job.id);
    if (job.revision !== revision) { revision = job.revision; console.log(JSON.stringify({ id: job.revision, event: "job", data: job })); }
    if (isTerminal(job.state)) { process.exitCode = job.state === "succeeded" ? 0 : 1; break; }
    await delay(200, undefined, { signal: shutdown.signal }).catch(() => {});
  }
} finally { await worker?.stop(); store.close(); }
