import { lstat, realpath, rm } from "node:fs/promises";
import path from "node:path";
import { JobStore } from "./store.ts";

/** Only registered, expired, unreferenced workspaces of terminal jobs are eligible. */
export async function cleanExpiredResources(store: JobStore): Promise<{ removed: number; skipped: number }> {
  const root = await realpath(store.artifactRoot);
  let removed = 0; let skipped = 0;
  for (const resource of store.retentionCandidates()) {
    const expected = path.join(resource.jobId, `attempt-${resource.attempt}`);
    if (resource.relativePath !== expected || !/^[A-Za-z0-9_-]{1,100}$/.test(resource.jobId)) { skipped++; continue; }
    const target = path.resolve(root, expected);
    try {
      // Refuse symlinked job parents or workspaces; never traverse into another project's data.
      const parent = await lstat(path.dirname(target));
      const item = await lstat(target);
      if (parent.isSymbolicLink() || item.isSymbolicLink() || await realpath(path.dirname(target)) !== path.join(root, resource.jobId)) { skipped++; continue; }
      await rm(target, { recursive: true, force: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") { skipped++; continue; }
    }
    store.forgetResource(resource.jobId, resource.attempt);
    removed++;
  }
  return { removed, skipped };
}
