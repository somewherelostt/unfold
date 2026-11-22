import { existsSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const web = path.join(root, "apps/web");
const compiler = path.join(web, "node_modules/typescript/bin/tsc");
const next = path.join(web, "node_modules/next/dist/bin/next");

function run(entry, args, cwd = root) {
  if (!existsSync(entry)) throw new Error("Workspace dependencies are missing. Run pnpm install first.");
  const result = spawnSync(process.execPath, [entry, ...args], { cwd, stdio: "inherit" });
  if (result.error) throw result.error;
  return result.status === 0;
}

// Route handler types must exist even in a fresh checkout without a prior build.
if (!run(next, ["typegen"], web)) process.exit(1);

let passed = true;
for (const directory of ["packages/core", "packages/agent", "packages/video", "services/media", "services/jobs", "apps/web"]) {
  const config = path.join(root, directory, "tsconfig.json");
  if (!existsSync(config)) {
    throw new Error(`Missing TypeScript configuration: ${directory}`);
  }
  process.stdout.write(`Checking ${directory}\n`);
  if (!run(compiler, ["--noEmit", "--incremental", "false", "-p", config])) passed = false;
}
if (!passed) process.exitCode = 1;
