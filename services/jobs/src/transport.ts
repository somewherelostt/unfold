import { setTimeout as delay } from "node:timers/promises";
import { validateEnqueueRequest } from "./store.ts";
import type { JobQueue } from "./factory.ts";
import { JobFault, isTerminal, type EnqueueRequest, type JobContext, type JobEvent } from "./types.ts";

/** HTTP clients cannot choose owner, project or retry/charging policy. Authorize the input before enqueue. */
export function parseClientJobRequest(value: unknown): Omit<EnqueueRequest, "retry"> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new JobFault("INVALID_REQUEST", "Invalid job request.");
  if (Object.keys(value).some((key) => !["kind", "input", "idempotencyKey"].includes(key))) throw new JobFault("INVALID_REQUEST", "Unexpected job settings.");
  validateEnqueueRequest(value as EnqueueRequest);
  return structuredClone(value) as Omit<EnqueueRequest, "retry">;
}
export const encodeJobEvent = (event: JobEvent) => `id: ${event.id}\nevent: job\ndata: ${JSON.stringify(event.data)}\n\n`;

/** Snapshot first, then durable revisions. Subscriber abort affects only this viewer. */
export async function* watchJob(store: JobQueue, ctx: JobContext, id: string, options: { after?: number; signal?: AbortSignal; pollMs?: number } = {}): AsyncGenerator<JobEvent> {
  let cursor = options.after ?? 0;
  if (!Number.isSafeInteger(cursor) || cursor < 0) throw new JobFault("INVALID_CURSOR", "Invalid event cursor.");
  const snapshot = await store.get(ctx, id);
  // Sending the latest snapshot intentionally supersedes older missed progress events.
  yield { id: snapshot.revision, event: "job", data: snapshot };
  cursor = snapshot.revision;
  if (isTerminal(snapshot.state)) return;
  while (!options.signal?.aborted) {
    for (const event of await store.events(ctx, id, cursor)) {
      cursor = event.id; yield event;
      if (isTerminal(event.data.state)) return;
    }
    await delay(options.pollMs ?? 500, undefined, { signal: options.signal }).catch(() => {});
  }
}
