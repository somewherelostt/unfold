import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { libraryChecks, publicChecks, runtimeChecks } from './check-runtime.mjs';

const env = { NODE_ENV: 'production', UNFOLD_DEV_NO_AUTH: '0', NEXT_PUBLIC_SITE_URL: 'https://unfold.maazx.dev', NEXT_PUBLIC_UNFOLD_AUTH_URL: 'https://unit.supabase.co', NEXT_PUBLIC_UNFOLD_AUTH_ANON_KEY: 'unit-public-key', NEXT_PUBLIC_UNFOLD_JOBS: '1' };
test('reject development identity, placeholder auth and non-HTTPS or credential-bearing origins', () => {
  assert.ok(Object.values(publicChecks(env)).every(Boolean));
  assert.equal(publicChecks({ ...env, UNFOLD_DEV_NO_AUTH: '1' }).noDevelopmentIdentity, false);
  assert.equal(publicChecks({ ...env, NEXT_PUBLIC_UNFOLD_AUTH_ANON_KEY: 'REPLACE_KEY' }).publicAuthKey, false);
  for (const url of ['http://unfold.maazx.dev', 'https://user:password@unfold.maazx.dev', 'https://unfold.maazx.dev/app']) assert.equal(publicChecks({ ...env, NEXT_PUBLIC_SITE_URL: url }).siteOrigin, false);
});
test('fresh-clone manifests fail until every referenced nonempty library file is copied', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'unfold-deploy-test-'));
  try {
    for (const kind of ['music', 'sfx']) {
      const dir = path.join(root, 'apps/web/public/assets', kind); await mkdir(dir, { recursive: true });
      await writeFile(path.join(dir, 'manifest.json'), JSON.stringify([{ url: '/assets/' + kind + '/clip.mp3' }]));
    }
    assert.deepEqual(await libraryChecks(root), { musicLibraryFiles: false, sfxLibraryFiles: false });
    for (const kind of ['music', 'sfx']) await writeFile(path.join(root, 'apps/web/public/assets', kind, 'clip.mp3'), 'fixture-bytes');
    assert.deepEqual(await libraryChecks(root), { musicLibraryFiles: true, sfxLibraryFiles: true });
    await writeFile(path.join(root, 'apps/web/public/assets/music/manifest.json'), JSON.stringify([{ url: '/assets/music/../../outside.mp3' }]));
    assert.equal((await libraryChecks(root)).musicLibraryFiles, false);
  } finally { await rm(root, { recursive: true, force: true }); }
});
test('missing runtime credentials are booleans, not leaked diagnostic values', async () => {
  const checks = await runtimeChecks('web', { ...env, UNFOLD_ENCRYPTION_KEY: 'private-invalid-key', UNFOLD_AUTH_SERVICE_KEY: '' });
  assert.equal(checks.encryptionKey, false); assert.equal(checks.serverAuthKey, false);
  assert.ok(!JSON.stringify(checks).includes('private-invalid-key'));
});
