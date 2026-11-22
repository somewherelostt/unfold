import { loadJobConfig } from "../src/config.ts";
import { verifyRecordedExecutionStopped } from "../src/process.ts";
import { JobStore } from "../src/store.ts";

const store = new JobStore(loadJobConfig());
try {
  const recovered = await store.recoverExpired((claim) => verifyRecordedExecutionStopped(store, claim));
  const blocked = store.expiredClaims().length;
  console.log(JSON.stringify({ recovered, blocked, detail: blocked ? "Some executions are live or unverifiable. Confirm they stopped before operator recovery." : "Expired recorded executions were reconciled." }));
  process.exitCode = blocked ? 1 : 0;
} finally { store.close(); }
