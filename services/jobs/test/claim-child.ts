import { JobStore } from "../src/store.ts";
const [databasePath, artifactRoot, worker] = process.argv.slice(2);
const store = new JobStore({ databasePath, artifactRoot, now: () => 1_000 });
try { console.log(JSON.stringify({ id: store.claim(worker)?.id ?? null })); }
finally { store.close(); }
