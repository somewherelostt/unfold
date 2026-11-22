import type { JobView } from "@unfold/jobs";

export type { JobView };

/** Reconnection snapshots can supersede missed events; older events cannot reverse progress. */
export function reconcileJob(current: JobView | undefined, incoming: JobView): JobView {
  if (current && incoming.id !== current.id) throw new Error("This job belongs to a different operation.");
  if (current && incoming.revision <= current.revision) return current;
  if (current && ["succeeded", "failed", "cancelled"].includes(current.state)) return current;
  return incoming;
}

/** Completion needs a terminal server result and an output reference, never an ended connection. */
export function hasJobOutput(job: JobView | undefined): boolean {
  return job?.state === "succeeded" && !!job.output;
}
