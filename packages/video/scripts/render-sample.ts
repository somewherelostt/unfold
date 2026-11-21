// Usage: pnpm --filter @unfold/video render:sample [sampleIndex] [outPath]
import path from "node:path";
import { fileURLToPath } from "node:url";
import { compileEditPlan, sampleAgentPlans, sampleAnalysis, sampleLibrary } from "@unfold/core";
import { renderPlan } from "../src/render";

const here = path.dirname(fileURLToPath(import.meta.url));
const i = Number(process.argv[2] ?? 0);
const out = process.argv[3] ?? path.join(process.env.TMPDIR ?? "/tmp", `unfold-sample-${i}.mp4`);
const plan = compileEditPlan(sampleAgentPlans[i], sampleAnalysis, sampleLibrary, { id: `sample-${i}` });
const t0 = Date.now();
let last = -1;
await renderPlan(plan, out, {
  publicDir: path.resolve(here, "../../../apps/web/public"),
  onProgress: (p) => {
    const pct = Math.floor(p * 10) * 10;
    if (pct !== last) console.log(`${pct}%`), (last = pct);
  },
});
console.log(`rendered ${out} in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
