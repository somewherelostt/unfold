import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test, type TestContext } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { syncLibrary } from './sync-library.mts';

const digest = (value: string) => createHash('sha256').update(value).digest('hex');
async function fixture(t: TestContext, names = ['music/fixture.mp3']) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'unfold-library-test-'));
  const version = 'a'.repeat(64), value = 'fixture audio';
  const manifest = { version, files: names.map(name => ({ path: name, bytes: Buffer.byteLength(value), sha256: digest(value) })) };
  await mkdir(path.join(root, 'infra/cloud'), { recursive: true });
  await writeFile(path.join(root, 'infra/cloud/library-integrity.json'), JSON.stringify(manifest));
  const previous = process.env.UNFOLD_LIBRARY_URL;
  process.env.UNFOLD_LIBRARY_URL = 'https://library.invalid/' + version;
  t.after(async () => { if (previous === undefined) delete process.env.UNFOLD_LIBRARY_URL; else process.env.UNFOLD_LIBRARY_URL = previous; await rm(root, { recursive: true, force: true }); });
  return { root, value, manifest, target: (name = names[0]) => path.join(root, 'apps/web/public/assets', name) };
}

test('library sync reuses verified files and atomically installs verified downloads', async t => {
  const f = await fixture(t, ['music/cached.mp3', 'sfx/download.wav']);
  await mkdir(path.dirname(f.target()), { recursive: true }); await writeFile(f.target(), f.value);
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    calls++; assert.match(url, /\/sfx\/download.wav$/); assert.equal(init.redirect, 'error');
    return new Response(f.value);
  });
  await syncLibrary(f.root);
  assert.equal(calls, 1); assert.equal(await readFile(f.target('sfx/download.wav'), 'utf8'), f.value);
  assert.deepEqual(await readdir(path.dirname(f.target('sfx/download.wav'))), ['download.wav']);
});

test('a changed library leaves the old cached file intact', async t => {
  const f = await fixture(t); await mkdir(path.dirname(f.target()), { recursive: true }); await writeFile(f.target(), 'old audio');
  t.mock.method(globalThis, 'fetch', async () => new Response('wrong content'));
  await assert.rejects(syncLibrary(f.root), /verified/);
  assert.equal(await readFile(f.target(), 'utf8'), 'old audio');
  assert.deepEqual(await readdir(path.dirname(f.target())), ['fixture.mp3']);
});

test('one failed download cancels and joins every sibling before sync exits', async t => {
  const f = await fixture(t, ['music/bad.mp3', 'music/pending.mp3', 'sfx/pending.wav']);
  let started = 0, settled = 0, release!: () => void;
  const allStarted = new Promise<void>(resolve => { release = resolve; });
  t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    if (++started === 3) release();
    if (url.endsWith('/bad.mp3')) { await allStarted; return new Response('bad'); }
    await new Promise<void>((_resolve, reject) => init.signal!.addEventListener('abort', () => { void delay(10).then(() => { settled++; reject(init.signal!.reason); }); }, { once: true }));
    throw Error('Unreachable download');
  });
  await assert.rejects(syncLibrary(f.root)); assert.equal(started, 3); assert.equal(settled, 2);
  await assert.rejects(readFile(f.target()), { code: 'ENOENT' });
});

test('startup cancellation aborts an in-flight download and starts no later files', async t => {
  const f = await fixture(t, ['music/one.mp3', 'music/two.mp3', 'music/three.mp3', 'music/four.mp3']);
  const shutdown = new AbortController(); let calls = 0, entered!: () => void;
  const firstFetch = new Promise<void>(resolve => { entered = resolve; });
  t.mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => {
    calls++; entered();
    await new Promise<void>((_resolve, reject) => { if (init.signal!.aborted) reject(init.signal!.reason); else init.signal!.addEventListener('abort', () => reject(init.signal!.reason), { once: true }); });
    throw Error('Unreachable download');
  });
  const pending = syncLibrary(f.root, shutdown.signal); await firstFetch; shutdown.abort(new Error('fixture shutdown'));
  await assert.rejects(pending, /fixture shutdown/); assert.ok(calls <= 3);
});

test('invalid manifest paths are rejected before any network request', async t => {
  const f = await fixture(t, ['../outside.mp3']); let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; throw Error('Unexpected network request'); });
  await assert.rejects(syncLibrary(f.root), /Invalid library manifest/); assert.equal(calls, 0);
});
