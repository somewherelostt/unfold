import { constants, existsSync } from 'node:fs';
import { access, readFile, stat, statfs } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const configured = (value) => typeof value === 'string' && value.length > 0 && !/REPLACE|YOUR_PROJECT/.test(value);
const httpsOrigin = (value) => {
  try { const u = new URL(value); return u.protocol === 'https:' && !u.username && !u.password && u.pathname === '/' && !u.search && !u.hash; }
  catch { return false; }
};
export function publicChecks(env) {
  return {
    production: env.NODE_ENV === 'production',
    noDevelopmentIdentity: env.UNFOLD_DEV_NO_AUTH !== '1',
    siteOrigin: httpsOrigin(env.NEXT_PUBLIC_SITE_URL),
    authOrigin: configured(env.NEXT_PUBLIC_UNFOLD_AUTH_URL) && httpsOrigin(env.NEXT_PUBLIC_UNFOLD_AUTH_URL),
    publicAuthKey: configured(env.NEXT_PUBLIC_UNFOLD_AUTH_ANON_KEY),
    durableJobsUi: env.NEXT_PUBLIC_UNFOLD_JOBS === '1',
  };
}

/** Check the exact manifest URLs. Git alone does not contain the audio files. */
export async function libraryChecks(repoRoot) {
  const checks = {};
  for (const kind of ['music', 'sfx']) {
    try {
      const rows = JSON.parse(await readFile(path.join(repoRoot, 'apps/web/public/assets', kind, 'manifest.json'), 'utf8'));
      if (!Array.isArray(rows) || !rows.length) throw new Error('Empty library');
      const prefix = '/assets/' + kind + '/';
      const valid = await Promise.all(rows.map(async (row) => {
        if (typeof row.url !== 'string' || !row.url.startsWith(prefix) || !/^[a-zA-Z0-9_-]+\.(mp3|wav)$/.test(row.url.slice(prefix.length))) return false;
        try { const s = await stat(path.join(repoRoot, 'apps/web/public', row.url)); return s.isFile() && s.size > 0; }
        catch { return false; }
      }));
      checks[kind + 'LibraryFiles'] = valid.every(Boolean);
    } catch { checks[kind + 'LibraryFiles'] = false; }
  }
  return checks;
}

async function executable(file) {
  if (!file || !path.isAbsolute(file)) return false;
  try { await access(file, constants.X_OK); return (await stat(file)).isFile(); }
  catch { return false; }
}
export async function runtimeChecks(scope, env = process.env) {
  if (!['web', 'media', 'publishing'].includes(scope)) throw new Error('Use web, media or publishing.');
  const root = env.UNFOLD_REPO_ROOT ?? '';
  const checks = {
    nodeVersion: Number(process.versions.node.split('.')[0]) >= 24,
    production: env.NODE_ENV === 'production',
    noDevelopmentIdentity: env.UNFOLD_DEV_NO_AUTH !== '1',
    checkout: path.isAbsolute(root) && existsSync(path.join(root, 'services/jobs/package.json')),
    privateDataPath: Boolean(env.UNFOLD_DATA_DIR && path.isAbsolute(env.UNFOLD_DATA_DIR) && !path.resolve(env.UNFOLD_DATA_DIR).startsWith(path.join(root, 'apps/web/public'))),
  };
  try {
    await access(env.UNFOLD_DATA_DIR, constants.W_OK);
    const fs = await statfs(env.UNFOLD_DATA_DIR);
    checks.diskReserve = Number(fs.bavail) * Number(fs.bsize) >= Number(env.UNFOLD_JOBS_MIN_FREE_BYTES ?? 5368709120);
  } catch { checks.diskReserve = false; }
  try { await access(env.TMPDIR, constants.W_OK); checks.scratchWritable = true; }
  catch { checks.scratchWritable = false; }
  for (const [name, variable] of [['ffmpeg', 'FFMPEG_PATH'], ['ffprobe', 'FFPROBE_PATH']]) checks[name] = await executable(env[variable]);
  if (scope === 'web') {
    Object.assign(checks, publicChecks(env));
    checks.serverAuthKey = configured(env.UNFOLD_AUTH_SERVICE_KEY);
    checks.encryptionKey = /^[a-fA-F0-9]{64}$/.test(env.UNFOLD_ENCRYPTION_KEY ?? '');
    checks.openclaw = await executable(env.UNFOLD_OPENCLAW_BIN);
    checks.productionBuild = existsSync(path.join(root, 'apps/web/.next/BUILD_ID'));
  }
  if (scope !== 'publishing') {
    Object.assign(checks, await libraryChecks(root));
    for (const [name, variable] of [['bun', 'UNFOLD_BUN_BIN'], ['speech', 'UNFOLD_STT_BIN'], ['browser', 'UNFOLD_BROWSER_EXECUTABLE'], ['referenceDownloader', 'UNFOLD_DOWNLOADER_BIN']]) checks[name] = await executable(env[variable]);
    for (const [name, variable] of [['englishModel', 'UNFOLD_STT_MODEL'], ['multilingualModel', 'UNFOLD_STT_MULTILINGUAL_MODEL']]) {
      try { const model = await stat(env[variable]); checks[name] = model.isFile() && model.size > 0; } catch { checks[name] = false; }
    }
  }
  if (scope === 'publishing' || env.UNFOLD_PUBLISHING_ENABLED === '1') {
    checks.publishingKey = configured(env.COMPOSIO_API_KEY);
    checks.publishingOrigin = httpsOrigin(env.UNFOLD_PUBLISHING_APP_ORIGIN);
    checks.productionInstance = configured(env.UNFOLD_PUBLISHING_INSTANCE_ID);
  }
  if (scope === 'web' && env.UNFOLD_PUBLISHING_ENABLED === '1') checks.callbackMatchesSite = env.UNFOLD_PUBLISHING_APP_ORIGIN === env.NEXT_PUBLIC_SITE_URL;
  if (scope === 'publishing') checks.dispatchEnabled = env.UNFOLD_PUBLISHING_ENABLED === '1';
  return checks;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const checks = await runtimeChecks(process.argv[2]);
    const ready = Object.values(checks).every(Boolean);
    // Output only named booleans: never credentials, signed URLs or raw provider errors.
    console.log(JSON.stringify({ scope: process.argv[2], ready, checks }, null, 2));
    if (!ready) process.exitCode = 1;
  } catch { console.error('Production preflight could not run. Use web, media or publishing with the configured environment.'); process.exitCode = 1; }
}
