import { readFile, mkdir, writeFile, rename, rm } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileSha256 } from '../../packages/cloud/src/blobs.ts';

type LibraryFile = { path: string; bytes: number; sha256: string };
export async function syncLibrary(repoRoot: string, signal?: AbortSignal) {
  signal?.throwIfAborted();
  const manifest = JSON.parse(await readFile(path.join(repoRoot, 'infra/cloud/library-integrity.json'), 'utf8')) as { version: string; files: LibraryFile[] };
  if (!/^[a-f0-9]{64}$/.test(manifest.version) || !Array.isArray(manifest.files) || manifest.files.some(item => !/^(music|sfx)\/[a-zA-Z0-9_.-]+\.(mp3|wav|json)$/.test(item.path) || !Number.isSafeInteger(item.bytes) || item.bytes < 1 || !/^[a-f0-9]{64}$/.test(item.sha256))) throw Error('Invalid library manifest.');
  const origin = new URL(process.env.UNFOLD_LIBRARY_URL ?? '');
  if (origin.protocol !== 'https:' || origin.username || origin.password || origin.search || origin.hash || !origin.pathname.endsWith('/' + manifest.version)) throw Error('Configure the versioned public audio library URL.');
  const shutdown = new AbortController();
  const abort = () => shutdown.abort(signal?.reason);
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  let next = 0;
  const download = async () => {
    for (;;) {
      shutdown.signal.throwIfAborted();
      const item = manifest.files[next++];
      if (!item) return;
      const target = path.join(repoRoot, 'apps/web/public/assets', item.path);
      let current = false;
      try { current = await fileSha256(target) === item.sha256; } catch { /* Missing or stale public cache. */ }
      shutdown.signal.throwIfAborted();
      if (current) continue;
      const response = await fetch(origin.href + '/' + item.path, { redirect: 'error', signal: AbortSignal.any([shutdown.signal, AbortSignal.timeout(60000)]) });
      if (!response.ok || !response.body) { await response.body?.cancel(); throw Error('The public audio library is unavailable.'); }
      const chunks: Uint8Array[] = [];
      let bytes = 0;
      const reader = response.body.getReader();
      try {
        for (;;) {
          const chunk = await reader.read();
          if (chunk.done) break;
          bytes += chunk.value.length;
          if (bytes > item.bytes) { await reader.cancel(); throw Error('The audio library changed.'); }
          chunks.push(chunk.value);
        }
      } finally { reader.releaseLock(); }
      shutdown.signal.throwIfAborted();
      const value = Buffer.concat(chunks);
      if (bytes !== item.bytes || createHash('sha256').update(value).digest('hex') !== item.sha256) throw Error('The audio library could not be verified.');
      await mkdir(path.dirname(target), { recursive: true });
      const temp = target + '.' + randomUUID() + '.part';
      try { await writeFile(temp, value, { flag: 'wx' }); shutdown.signal.throwIfAborted(); await rename(temp, target); }
      finally { await rm(temp, { force: true }); }
    }
  };
  try {
    // Cancel sibling downloads on failure and wait for all of them before startup exits.
    const results = await Promise.allSettled(Array.from({ length: 3 }, () => download().catch(error => { shutdown.abort(error); throw error; })));
    const failure = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
    if (failure) throw failure.reason;
  } finally { signal?.removeEventListener('abort', abort); }
}
