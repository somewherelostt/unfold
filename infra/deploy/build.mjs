import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { libraryChecks, publicChecks } from './check-runtime.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
if (process.argv.length !== 3) throw new Error('Usage: node infra/deploy/build.mjs /etc/unfold/common.env');
process.loadEnvFile(process.argv[2]);
const checks = { ...publicChecks(process.env), ...await libraryChecks(root) };
const missing = Object.entries(checks).filter(([, ok]) => !ok).map(([name]) => name);
if (missing.length) throw new Error('Build prerequisites failed: ' + missing.join(', '));
const web = path.join(root, 'apps/web');
if (existsSync(path.join(web, '.next/lock'))) throw new Error('Another production build may be running. Finish it before rebuilding.');
// This generated cache previously retained old CSS after source changes.
await rm(path.join(web, '.next/cache/turbopack'), { recursive: true, force: true });
const code = await new Promise((resolve, reject) => {
  // Do not pass --env-file to Next's Node process: worker re-exec can copy it into
  // NODE_OPTIONS, where Node rejects it. Only the intended environment is inherited.
  const child = spawn(process.execPath, [path.join(web, 'node_modules/next/dist/bin/next'), 'build'], { cwd: web, env: process.env, stdio: 'inherit' });
  child.once('error', reject); child.once('exit', resolve);
});
if (code !== 0) { process.exitCode = 1; }
else {
  const css = [];
  async function scan(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) await scan(file); else if (entry.name.endsWith('.css')) css.push(await readFile(file, 'utf8'));
    }
  }
  await scan(path.join(web, '.next/static'));
  if (!/scrollbar-gutter:\s*stable/.test(css.join('\n'))) throw new Error('The production CSS is stale: stable scrollbar gutter is missing.');
  console.log('Production build and emitted layout-stability CSS verified.');
}
