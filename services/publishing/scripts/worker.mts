import path from "node:path";
import { fileURLToPath } from "node:url";
import { createPublishingRuntime } from "../../../apps/web/src/server/publishing/runtime.ts";
import { runPublishingWorker } from "../src/worker.ts";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const runtime = createPublishingRuntime(root);
if (!runtime.config.enabled || !runtime.config.apiKey) {
  console.error("Publishing is paused. Complete protected server configuration before starting the worker."); runtime.store.close(); process.exitCode = 1;
} else {
  const stop = new AbortController(); process.once("SIGINT", () => stop.abort()); process.once("SIGTERM", () => stop.abort());
  await runPublishingWorker(runtime.store, runtime.publisher, stop.signal); runtime.store.close();
}
