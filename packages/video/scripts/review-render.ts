// Usage: node --import tsx scripts/review-render.ts --plan /abs/plan.json --output /abs/edit.mp4 --review-dir /abs/review --public-dir /abs/public [--media-dir /abs/media] [--analysis /abs/analysis.json]
import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { EditPlan, MediaAnalysis } from "@unfold/core";
import { reviewRenderedPlan } from "../src/review";

const { values } = parseArgs({ options: { plan: { type: "string" }, output: { type: "string" }, "review-dir": { type: "string" }, "public-dir": { type: "string" }, "media-dir": { type: "string" }, analysis: { type: "string" } } });
if (!values.plan || !values.output || !values["review-dir"] || !values["public-dir"]) throw new Error("Required: --plan, --output, --review-dir and --public-dir.");
const plan = EditPlan.parse(JSON.parse(await readFile(values.plan, "utf8")));
const analysis = values.analysis ? MediaAnalysis.parse(JSON.parse(await readFile(values.analysis, "utf8"))) : undefined;
const report = await reviewRenderedPlan(plan, { outputPath: values.output, reviewDir: values["review-dir"], publicDir: values["public-dir"], mediaDir: values["media-dir"], analysis });
console.log(JSON.stringify({ passed: report.passed, errors: report.errors, warnings: report.warnings, coverage: report.coverage, metrics: report.metrics, artifacts: report.artifacts }, null, 2));
if (!report.passed) process.exitCode = 1;
