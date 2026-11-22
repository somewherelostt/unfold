import { loadJobConfig } from "../src/config.ts";
import { checkReadiness } from "../src/health.ts";
import { JobStore } from "../src/store.ts";

const config = loadJobConfig();
const store = new JobStore(config);
try {
  const result = await checkReadiness(config, store, { requireWorker: process.argv.includes("--require-worker") });
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.ready ? 0 : 1;
} finally { store.close(); }
