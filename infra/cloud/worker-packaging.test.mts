import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
for (const [image, message] of [['media', 'Cloud worker requires Supabase storage.'], ['publishing', 'Cloud publishing requires Supabase storage.']]) {
  test(`${image} image entrypoint resolves its real module graph before the disabled-backend guard`, async () => {
    const dockerfile = await readFile(path.join(repo, `infra/cloud/Dockerfile.${image}`), 'utf8');
    const command = JSON.parse(dockerfile.match(/^CMD (.+)$/m)![1]) as string[];
    const temporary = await mkdtemp(path.join(os.tmpdir(), 'unfold-worker-import-'));
    try {
      // No credentials are inherited. The explicit backend guard stops before creating
      // queues, opening health ports, syncing the library or entering a worker loop.
      const result = spawnSync(process.execPath, command.slice(1), {
        cwd: path.join(repo, 'apps/web'), encoding: 'utf8', timeout: 15_000,
        env: { PATH: process.env.PATH, HOME: temporary, TMPDIR: temporary, NODE_ENV: 'production',
          TSX_TSCONFIG_PATH: path.join(repo, 'apps/web/tsconfig.json'), UNFOLD_BACKEND: 'disabled', UNFOLD_CLOUD_WORKER: '1',
          UNFOLD_REPO_ROOT: repo, UNFOLD_DATA_DIR: temporary, UNFOLD_CLOUD_CACHE_DIR: path.join(temporary, 'cache') },
      });
      assert.ifError(result.error); assert.equal(result.status, 1);
      assert.ok(result.stderr.includes(message), result.stderr);
      assert.doesNotMatch(result.stderr, /ERR_MODULE_NOT_FOUND|Cannot find module|client component/);
    } finally { await rm(temporary, { recursive: true, force: true }); }
  });
}

test('the media worker can load the deferred editing module with the image react-server and TSX settings', () => {
  const result = spawnSync(process.execPath, ['--conditions=react-server', '--import', '../../packages/video/node_modules/tsx/dist/loader.mjs', '--input-type=module', '-e', 'await import("./src/server/cloud-editing.ts");console.log("deferred imports ready")'], {
    cwd: path.join(repo, 'apps/web'), encoding: 'utf8', timeout: 15_000,
    env: { PATH: process.env.PATH, NODE_ENV: 'production', TSX_TSCONFIG_PATH: path.join(repo, 'apps/web/tsconfig.json'), UNFOLD_BACKEND: 'disabled' },
  });
  assert.ifError(result.error); assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /deferred imports ready/);
});
