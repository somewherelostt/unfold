import path from 'node:path';
import { tmpdir } from 'node:os';
import { cloudEnabled } from '@unfold/cloud';
import { PrivateStorage } from './private-storage.ts';
import { SupabasePrivateStorage } from './supabase-storage.ts';

/** Cloud paths are disposable worker caches; Postgres and private blobs hold durable state. */
export function createPrivateStorage(localRoot: string): PrivateStorage {
  return cloudEnabled()
    ? new SupabasePrivateStorage(process.env.UNFOLD_CLOUD_CACHE_DIR ?? path.join(tmpdir(), 'unfold-cloud-cache'))
    : new PrivateStorage(localRoot);
}
