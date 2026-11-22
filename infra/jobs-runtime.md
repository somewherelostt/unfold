# Durable media jobs: local and persistent-host foundation

This implements a queue/worker library and additive authenticated `/api/jobs` routes. Existing synchronous/SSE routes remain available. It does not deploy Unfold: no hosted URL, production auth provider or external storage was configured by this slice. Queue/bridge behavioral tests use injected media execution and explicitly are not an end-to-end MP4 export. The real application bindings invoke existing analysis/render/review functions through an isolated child; a coordinated real worker export remains a separate acceptance step.

## Storage and runtime

The queue uses Node >=24's built-in `node:sqlite`, a local disk SQLite database with WAL, `synchronous=FULL`, a busy timeout and `BEGIN IMMEDIATE` transitions. Both API and workers must open the **same absolute database path on the same persistent host**. Independent processes are supported; a network filesystem, separate replicas with separate disks, an ephemeral serverless filesystem and multi-host workers are not supported. Keep the SQLite database, `-wal` and `-shm` files together; use a SQLite-aware backup or stop all writers before copying them. This is job metadata durability, not a backup/replication service. Schema version 1 is created automatically; a newer database version fails closed. No existing media or plan data is migrated.

Node owns durable state. Use the repository's installed `tsx` loader for standalone application bindings, which import existing storage TypeScript containing parameter properties. Bun executes the media workspace in each isolated child. Provision FFmpeg, FFprobe, the local speech executable and model, and a compatible browser before startup. The browser is explicit: `UNFOLD_BROWSER_EXECUTABLE`. For this checkout, reuse the existing binary under `apps/web/node_modules/.remotion/chrome-headless-shell/mac-arm64/chrome-headless-shell-mac-arm64/chrome-headless-shell`; do not download another browser during a job. Linux deployments must configure their own provisioned executable path.

OpenClaw runs Kimi on Cerebras. The readiness check verifies the configured gateway health endpoint and the presence of a gateway credential without exposing it or performing inference. It does not prove gateway authentication or a model completion. Analysis/render jobs do not themselves generate charged completions. `UNFOLD_JOBS_REQUIRE_GATEWAY=false` permits a deliberately media-only worker; the product's planning readiness still requires the gateway. Credentials stay in protected runtime configuration, never job requests, references, events or errors.

`infra/jobs.env.example` and `infra/systemd/unfold-worker.service` are templates. No account, directory, credential, service or deployment is created by them. On a prepared POSIX host, provision Node >=24 and Bun, install the repository's pinned dependencies, provision tools/model/browser, mount persistent storage at `/var/lib/unfold`, create a restricted `unfold` service account, and protect `/etc/unfold/jobs.env`. Adapt absolute executable/repository paths and supply a real binding module before enabling the service. API/web must use the same queue configuration and storage owner. A process supervisor must terminate the worker's entire control group on forced shutdown; the systemd example sets `KillMode=control-group`.

From the repository root:

```sh
node --test services/jobs/test/*.test.ts
apps/web/node_modules/.bin/tsc --noEmit -p services/jobs/tsconfig.json
node --env-file=/absolute/private/jobs.env services/jobs/scripts/health.ts
node --env-file=/absolute/private/jobs.env services/jobs/scripts/recover.ts
node --env-file=/absolute/private/jobs.env --import ./packages/video/node_modules/tsx/dist/loader.mjs services/jobs/scripts/worker.ts
node --import ./packages/video/node_modules/tsx/dist/loader.mjs --test apps/web/src/server/jobs.test.mjs
```

Readiness checks runtime/tools/model/browser, SQLite integrity, scratch and database disk reserve, configured bindings, optional recent worker heartbeat, expired leases and overdue execution budgets. It returns only boolean checks and safe descriptions. `health.ts --require-worker` requires a recent heartbeat. Storage configuration does not prove the mount is persistent; verify that operationally. Provision tools rather than allowing runtime downloads. The default disk reserve is 1 GiB; space can still run out during a large render, so size the persistent volume and constrain uploads at the storage boundary.

## API integration contract

`apps/web/src/server/jobs.ts` implements the owner-bound API bridge with a shared server-side `JobStore`; `job-bindings.ts` is also loadable by the standalone worker. `@unfold/jobs` belongs only in the Node server runtime, never a client/edge bundle. UI activation is separately gated by `NEXT_PUBLIC_UNFOLD_JOBS=1`; keep it off until a worker and the real export acceptance are ready. The API enqueues work; it does not launch a worker or tie work to the request.

1. Authenticate the request; derive `{ownerId, projectId}` on the server. Call private storage's owner-bound project lookup and validate the referenced upload or immutable plan revision before enqueueing. Never take ownership from a request body. Legacy ownerless files remain outside this namespace.
2. Register a private-storage job reference **before** enqueueing, including the immutable input revision. Coordinate that registration and enqueue failure cleanup with the storage owner. Keep references until the durable job is terminal and owned execution has stopped. `MediaJobBindings.withProjectLease` repeats the ownership check and holds the storage lease during resolution, execution and publish; it must not remove a queued job's reference just because a viewer disconnects.
3. `POST /api/jobs` accepts the application request below, rejects owner/project/retry/extra settings, and derives project context from its authenticated upload/plan. It canonicalizes and validates the exact clicked preview through `prepareExportPlan`, then writes an immutable private snapshot. Internal queue inputs refer only to that snapshot ID/revision or owned upload ID. The application server chooses one attempt with no automatic retry. HTTP 202 is `{job,created}`, including an existing idempotent job. Foreign owner/project lookups are the same 404 as unknown jobs.
4. `GET .../jobs/:id` returns `{job}`. `POST .../jobs/:id/cancel` returns `{job}` and means explicit cancellation. Running cancellation is `running` with `cancelRequestedAt` and progress stage `cancelling` until execution stops, then `cancelled`. Request abort and SSE disconnect never cancel the job.
5. SSE `GET .../jobs/:id/events` uses `watchJob(store,ctx,id,{after,signal})` and `encodeJobEvent`. The generator first sends the current snapshot, then durable later revisions until terminal. `Last-Event-ID`/`after` is a nonnegative integer; the current snapshot supersedes missed intermediate progress. `store.events(ctx,id,after,limit)` also supports ordered historical polling. Send periodic SSE comment keepalives in the HTTP layer; set no-store and a suitable streaming timeout. The status endpoint is always the recovery fallback. Do not wrap enqueue and execution in the SSE callback.
6. `GET /api/jobs/:id/result` returns the existing analysis payload or export-ready payload only after success, otherwise 409. Queue output is an opaque owner-bound result manifest reference, resolved through private storage. Ready data contains `url`, optional `review`, `reviewUrl`, `contactSheetUrl` or explicit `reviewError`, plus `submittedInputFingerprint`, `renderedPlanFingerprint`, and `settings:{resolution,burnCaptions}`. The submitted fingerprint attests the preview before canonicalization/settings; the rendered fingerprint covers the trusted canonical plan before transient capability decoration. A review failure preserves the completed MP4. Never persist caller paths or transient capability URLs in the immutable snapshot or queue.

Client request:

```json
{"kind":"render","planId":"plan_123","resolution":"720p","burnCaptions":true,"idempotencyKey":"export-click-7e8949ef"}
```

Render requests may include `editPlan` for the current preview. Analysis uses `{"kind":"analysis","videoId":"upload_123","idempotencyKey":"analyze-click-7e8949ef"}`. Upload IDs are immutable in private storage. Keep the idempotency key for reconnects and double clicks; create a new key for an intentional repeat. Its scope is owner + project. Reusing it with changed input/settings is 409. Keys remain durable with job metadata; terminal history currently has no automatic deletion, so idempotency does not silently expire.

Progress event (the numeric ID and `revision` are the same monotonically increasing durable event sequence; gaps between one job's events are normal):

```text
id: 12
event: job
data: {"id":"8d3a2e32-53bb-4d32-a819-f808f63425de","kind":"render","state":"running","input":{"kind":"plan","id":"plan_123","revision":"sha256_immutable_revision"},"output":null,"progress":{"fraction":0.42,"stage":"rendering"},"attempt":1,"maxAttempts":1,"createdAt":1795320000000,"updatedAt":1795320004000,"startedAt":1795320001000,"finishedAt":null,"availableAt":1795320000000,"cancelRequestedAt":null,"error":null,"revision":12}
```

Completion has `state:"succeeded"`, `progress:{fraction:1,stage:"complete"}`, `finishedAt` and `output:{kind:"video",id:"export_manifest_123",revision:"..."}`. Failed jobs have a safe `{code,message,transient}` error. Client views contain no owner IDs, claim tokens, runtime process IDs or credentials. Owner identity is never inferred from possession of a job ID.

## Owner-bound media bindings and real harness

The real application binding `apps/web/src/server/job-bindings.ts` exports `createHandlers(config)` and `authorizeInput(context,input)` and uses the existing `PrivateStorage`. Set `UNFOLD_JOB_BINDINGS` to its absolute path. Set `UNFOLD_INTERNAL_ORIGIN` to the trusted web origin reachable by the browser worker; it is never taken from request headers. Analysis stages existing owned results into private attempt scratch and delegates fingerprint/model/language/frame cache validation to `analyzeVideo`, rather than trusting an analyzed status flag. Publication stages/syncs files and only then changes the owner manifest's analyzed marker. Rendering rechecks the immutable snapshot hash, issues exact-file media capabilities, renders with the existing explicit browser and two internal workers, reviews within the same isolated process group (120-second signal inspection and at most 18 sampled frames), then publishes/syncs owned MP4/report/artifacts and a result manifest. Capability-bearing scratch input is removed in `finally`; grants are revoked and expire independently.

The generic library `createMediaJobHandlers(bindings,runtime)` remains available for custom integrations around the **existing** analysis/render signatures. It does not invent a second media store. Its injection points are:

- `resolveUpload(ctx,reference) -> {inputPath,videoId}` and `resolvePlan(ctx,reference) -> {plan,revision}`, each using private storage's owner-bound reference lookup. The adapter verifies the resolved plan revision matches the enqueued immutable revision. An uploaded source's immutability/version check belongs in its resolver.
- `withProjectLease(ctx,execute)`: check owner/project, retain the queued job reference, acquire/renew the project storage lease, run the callback, then release the execution lease in `finally`. Unregister the durable job reference only after terminal state is safely observed by integration. The queue cannot make an independent storage registry transaction atomic; integration must reconcile a crash between registration/enqueue/terminal cleanup.
- `publishAnalysis(ctx,{analysis,dir,sourcePath,timings})` and `publishRender(ctx,{path})`: atomically publish under the owner/project storage lease, check cancellation/deletion state, and return `{output,retainWorkspace?}`. Rebase analysis URLs when publishing. If moving/copying into private storage, return `retainWorkspace:false`; if its output manifest intentionally references the job workspace, return `true` and release it only after that reference is removed. Publishing must be idempotent per job/attempt, since a crash can occur after storage publication but before queue completion.
- Runtime paths are trusted host configuration, never job payloads. `assetBaseFor(ctx)` mints a short-lived, file/project-scoped capability for that render attempt because the browser child has no signed-in cookies. The capability must expire promptly; it is kept only in a private attempt file while the child runs and removed in `finally`. A hard crash can leave this scratch file until reconciliation/retention, so expiry is mandatory. Never include raw API keys in it. Renderer browser support is an explicit `browserExecutable` option on the owned renderer module.

Custom binding modules must export `createHandlers(config): Promise<Partial<Record<JobKind,JobHandler>>>` and, for the operator harness, `authorizeInput(context,input): Promise<void>`. Resolve/publish callbacks are storage-only; all tools including rendered review stay inside the isolated task or require a supervisor-specific recovery proof. Do not launch an untracked review process from `publishRender`. There is no fallback which accepts an arbitrary path or acts as a different owner.

For the internal operator harness, first enqueue a real owned preview through the API to obtain its immutable `job.input.id/revision`. Use that snapshot reference in an operator-only JSON file (the harness accepts the internal reference contract, not the public client body), then run:

```json
{"ownerId":"real_authenticated_owner","projectId":"real_private_project","request":{"kind":"render","input":{"kind":"plan","id":"real_plan","revision":"real_immutable_revision"},"idempotencyKey":"integration-render-unique-01"}}
```

```sh
node --env-file=/absolute/private/jobs.env --import ./packages/video/node_modules/tsx/dist/loader.mjs services/jobs/scripts/integration.ts /absolute/private/operator-request.json
```

Use a separate integration queue database/volume to avoid claiming unrelated queued production work. The harness authorizes the input through the real binding, enqueues it, runs the real handler and prints durable snapshots and the final output reference. Inspect the resulting MP4 and rendered review separately. Until this is connected and run, the behavioral tests establish queue behavior only.

## Leases, limits, cancellation and recovery

Defaults are 32 queued jobs; 4 outstanding per owner across projects; 2 running globally; 1 running per owner/project; 1 render job and 1 analysis job concurrently. Rendering's internal worker count is independently 2 in the adapter (validated in 1–8). Each job has a 20-minute total execution budget, including earlier attempts, a 30-second claim lease and periodic heartbeats. The environment example exposes these limits. Upload size/duration/storage quotas remain private storage's responsibility. A handler which ignores cancellation keeps capacity occupied until it actually stops; the system fails closed instead of falsely announcing cancellation.

`BEGIN IMMEDIATE` makes queue checks, idempotency, claim and transition atomic across local processes. Each attempt has a new unguessable lease token; stale progress/completion cannot overwrite the next attempt. A lease is not proof that a process died. Expired running jobs **continue to occupy capacity** and are not automatically stolen. Readiness reports them. Unknown exceptions are permanent safe failures with no raw tool log/key/path in client state. Only explicit `HandlerFailure(...,true)` plus server-chosen `safeToRetry:true` enables retry, at most three total attempts with bounded exponential delay. Validation/permanent failures never retry. Charged generation and irreversible actions must keep `safeToRetry:false`.

The isolated runner uses a POSIX process group, sends SIGTERM then SIGKILL after a grace period, and waits until the group is gone before settling. Attempt `process.json` and `worker.json` record host/process/lease identity and completion. A stopped media child does not authorize recovery while the old parent is still resolving/publishing; the verifier requires the whole handler's completion marker or the old parent and recorded group both gone. Normal supervisor shutdown aborts handlers and waits; forced systemd shutdown kills the whole control group. The recovery command reconciles only expired attempts with matching local records which prove stopped work. The supplied long-running worker repeats that conservative check, including leases that expire after the replacement worker starts. It never kills an unknown/reused process. If records are missing, the host changed, or an old group/parent is still alive, it leaves the job blocked for operator verification. After a confirmed stop, cancellation wins; otherwise safe transient work can retry within policy and unsafe work fails as `WORKER_INTERRUPTED`. For a custom injected handler, provide a supervisor-specific `verifyStopped` to `store.recoverExpired` only after proving all its work stopped. Never use an unconditional `true` verifier in a live service.

## Retention and deletion

Only paths generated by `store.workspace(claim)` are registered for cleanup: `<artifactRoot>/<server job ID>/attempt-N`. Resources default to 24-hour expiry. Cleanup preserves all pending/running jobs, referenced output workspaces, user source media, private storage output and other project paths. It refuses symlinked workspaces/parents. Terminal metadata/events and idempotency records are currently retained; there is no silent deletion of history. Operate within the queue volume's capacity and add an explicit audited metadata archival/tombstone policy before large-scale deployment.

For project/account deletion, authenticated integration must first block new enqueues under the private storage deletion lock, explicitly cancel referenced jobs (`cancel(ctx,id)` or trusted account-wide `cancelOwner(ownerId)`), wait for terminal status/`ownerHasLiveWork(ownerId) === false`, remove external output references, then call `releaseOutput` for owned terminal jobs and remove private storage data through its owner. Scratch cleanup cannot delete source files. Cancellation alone does not authorize account deletion or prove a render stopped. Keep job refs/leases while waiting; reconcile them after crashes.

## Verified scope and remaining work

Tests exercise durable reopen/worker restart, independent-process claim exclusion, owner+project access and quotas, durable idempotency, independent render concurrency, cancellation, bounded safe transient retries, lease expiry/fencing, reconnect, safe failures and retention. Bridge tests invoke the actual route functions with only authentication/media-execution boundaries injected, using real private storage and SQLite: they cover snapshot immutability, canonical/submitted attestation, scoped/revoked media capabilities, output/review publication, failed-review MP4 preservation, source cache delegation, conflict reference cleanup and project drain. Fixture bytes are never presented as a real media export. Before deployment, configure and supervise a real worker, execute one coordinated bounded render and inspect its actual MP4/review, run host restart/disk-exhaustion drills, configure backups/logging/monitoring and verify service/tool compatibility on the target host. No production deployment was performed.

## Production deployment at unfold.maazx.dev

Prepared 2026-11-22 for the current single-host implementation. Local actual durable export/reload acceptance and immediate/scheduled publication receipts are recorded in `infra/publishing-operations.md`; they do not replace the signed-in target-host acceptance below. No VPS, DNS record, Supabase project or production service has been provisioned yet.

### Hosting and process layout

Use one x86-64 Ubuntu 24.04 VPS with a persistent ext4/XFS local disk. The starting sizing recommendation is 8 vCPUs, 16 GB RAM and at least 160 GB disk, with only one media job running at a time. This is a sizing estimate, not a measured capacity guarantee. Hetzner Cloud is a suitable first host; choose a dedicated-vCPU plan for predictable sustained rendering, or a shared x86 plan for a small launch and measure actual rendering load. Choose the VPS and Supabase in nearby regions, such as Singapore when serving India. Confirm current regional price and IPv4 charges in the provider console.

Run these services on that same host:

| Service | Purpose | Configuration |
| --- | --- | --- |
| Caddy | HTTPS for `unfold.maazx.dev`, streaming reverse proxy | `infra/deploy/Caddyfile` |
| `unfold-web` | Next production server, authenticated API, per-user AI execution | common + web + publishing env files |
| `unfold-worker` | Durable analysis/export/review queue | common env only |
| `unfold-publishing` | Timed dispatch, upload/processing and independent platform receipts | common + publishing env files |
| Managed Supabase | Sign-in and encrypted API-key rows | schema migration + SMTP |

Current private project files and both queue databases require the same host/directory. A web-only serverless deployment or separate worker services with separate disks do not satisfy this contract. Supabase Storage/S3/R2 are not implemented substitutes for the private filesystem. Object storage can hold encrypted backups. Keep the public internet entry to Caddy; Next listens on `127.0.0.1:3000`. No permanent public OpenClaw gateway is needed for production: each authenticated generation starts a restricted loopback child with that user's saved Cerebras key.

### 1. DNS and server prerequisites

Create only this new record at the DNS provider for `maazx.dev`:

| Type | Name | Value |
| --- | --- | --- |
| A | `unfold` | VPS public IPv4 |

Add an AAAA record only if this host actually serves that IPv6 address. Leave the portfolio's root/www records unchanged. Start with DNS-only routing if the DNS vendor offers an optional HTTP proxy: 500 MB uploads and long streams must not be cut off by a separate proxy's limits. Open ports 80/443 and restrict SSH to your administrative access. Enable time synchronization and use UTC on the server.

Install a currently patched Node 24 LTS or supported Node 26 release, with the executable at `/usr/local/bin/node` (or edit all unit paths consistently). Pin pnpm `12.14.0`, Bun `1.3.14`, and the locally exercised OpenClaw version `2026.11.6` initially. Do not substitute a newer OpenClaw release without running the real per-user generation test: its configuration schema is an integration dependency. Follow the official Node/OpenClaw installation instructions and verify their current runtime-security requirements.

Install Git, CMake/build tools, FFmpeg/FFprobe, Python venv support and Chrome shared libraries. For Ubuntu 24.04, typical packages are:

```sh
sudo apt-get update
sudo apt-get install -y git ca-certificates curl unzip build-essential cmake \
  ffmpeg python3-venv fontconfig fonts-liberation libnss3 libdbus-1-3 \
  libatk1.0-0t64 libatk-bridge2.0-0t64 libgbm1 libasound2t64 \
  libxrandr2 libxkbcommon0 libxfixes3 libxcomposite1 libxdamage1 \
  libpango-1.0-0 libcairo2 libcups2t64
```

Install Bun/OpenClaw from their official distributions and place the executables under `/usr/local/bin` so the service PATH and environment match. Do not run OpenClaw onboarding or install a separate shared daemon for this per-user production path. `UNFOLD_OPENCLAW_BIN` selects the CLI; the web application supplies each child's isolated configuration.

Clone the private repository using your deployment account/read-only GitHub deploy key, then place the checkout at `/opt/unfold`. Do not embed a GitHub token in the clone URL or the web environment. Create the runtime user and directories:

```sh
sudo useradd --system --create-home --home-dir /var/lib/unfold --shell /usr/sbin/nologin unfold
sudo install -d -o unfold -g unfold -m 0700 /var/lib/unfold /var/cache/unfold
sudo install -d -o root -g unfold -m 0750 /etc/unfold
sudo chown -R unfold:unfold /opt/unfold
cd /opt/unfold
sudo -u unfold /usr/local/bin/pnpm install --frozen-lockfile
```

Build a pinned release of the official `ggml-org/whisper.cpp` into `/opt/whisper.cpp`, download both the `base.en` and `base` GGML models using its official script, then give `unfold` read/execute access. Record the chosen release and model hashes in your host inventory. The English model cannot supply Hindi/automatic language recognition. The existing `services/media/scripts/setup.sh` is Homebrew-specific; do not run it on Ubuntu.

```sh
# From your checked-out, reviewed whisper.cpp release:
cmake -B build -DCMAKE_BUILD_TYPE=Release
cmake --build build -j 4 --config Release
sh models/download-ggml-model.sh base.en
sh models/download-ggml-model.sh base

# Install the reference downloader in its own venv, not system Python:
sudo python3 -m venv /opt/unfold-tools
sudo /opt/unfold-tools/bin/pip install yt-dlp==2026.10.26
sudo ln -s /opt/unfold-tools/bin/yt-dlp /usr/local/bin/yt-dlp

# Provision the Linux Remotion browser at install time, not during a job:
cd /opt/unfold/apps/web
sudo -u unfold /usr/local/bin/pnpm exec remotion browser ensure
```

Check the actual browser location printed by the installed command and update `UNFOLD_BROWSER_EXECUTABLE` if it differs from the template. Use `ldd` on that executable and resolve any missing shared library before starting services. Do not copy the Mac executable.

### 2. Transfer the real music/SFX library

The Git-tracked manifests reference 32 music tracks and 34 effects, while their media bytes are deliberately Git-ignored. A fresh clone without these files is incomplete. A checked local bundle has been prepared at `tmp/deployment/public-library.tar.gz`, with a sidecar `public-library.sha256`; it contains only 68 public library files/manifests, not uploaded footage, credentials, models or browser binaries. Preserve the associated licensing/source records and ensure the selected assets are cleared for the production use case.

Copy both files privately to the new host, extract into `/opt/unfold/apps/web/public`, and verify from that directory:

```sh
sudo tar -xzf /tmp/public-library.tar.gz -C /opt/unfold/apps/web/public
cd /opt/unfold/apps/web/public
sha256sum -c /tmp/public-library.sha256
sudo chown -R unfold:unfold assets
```

Do not copy the local `.env`, the local `data/` tree or development-owner social connections to make production look signed in. Use a new real account and upload the desired source footage through that account.

### 3. Configure managed production auth

Create a Supabase project. Set its Site URL to `https://unfold.maazx.dev`. Add the production callback `https://unfold.maazx.dev/auth/callback` to the redirect allow list; test the actual `next` query emitted by the app. Use exact production paths rather than a general domain wildcard. Enable email sign-in, configure a real SMTP sender/domain (for example Resend), and apply the SPF/DKIM records supplied by that email provider. The default Supabase SMTP service is restricted and unsuitable for customer sign-in.

The app supports both an emailed code and link. In the Magic Link email template include `{{ .Token }}` for the code and `{{ .ConfirmationURL }}` for the link. Start with the provider's six-digit token setting matching the UI. Apply `db/migrations/20261122000000_api_keys.sql` in the project's SQL editor. It creates `public.api_keys` with row-level ownership policies and no anonymous access. Keep RLS enabled; the server-only privileged key must never reach browser code.

Copy the templates:

```sh
sudo install -o root -g unfold -m 0640 /opt/unfold/infra/deploy/common.env.example /etc/unfold/common.env
sudo install -o root -g root -m 0600 /opt/unfold/infra/deploy/web.env.example /etc/unfold/web.env
sudo install -o root -g root -m 0600 /opt/unfold/infra/deploy/publishing.env.example /etc/unfold/publishing.env
sudoedit /etc/unfold/common.env /etc/unfold/web.env /etc/unfold/publishing.env
```

| Variable | Source / role |
| --- | --- |
| `NEXT_PUBLIC_SITE_URL` | `https://unfold.maazx.dev`, present at build and runtime |
| `NEXT_PUBLIC_UNFOLD_AUTH_URL` | Supabase project URL, present at build and runtime |
| `NEXT_PUBLIC_UNFOLD_AUTH_ANON_KEY` | Supabase publishable/legacy anon key, public by design; RLS still required |
| `UNFOLD_AUTH_SERVICE_KEY` | Supabase server secret/service-role key; only web service |
| `UNFOLD_ENCRYPTION_KEY` | Independently generated 32 bytes encoded as 64 hex characters; only web service |
| `COMPOSIO_API_KEY` | Protected publishing-project key; web and publishing worker |
| `UNFOLD_DATA_DIR` | Same `/var/lib/unfold` for all services |
| `UNFOLD_INTERNAL_ORIGIN` | Loopback Next origin `http://127.0.0.1:3000` for browser rendering |
| `UNFOLD_PUBLISHING_APP_ORIGIN` | Public `https://unfold.maazx.dev` for account return |
| `UNFOLD_PUBLISHING_INSTANCE_ID` | Stable `unfold-production`; do not change after accounts connect |
| `NEXT_PUBLIC_UNFOLD_JOBS` | `1`, compiled at build time when the media worker is configured |
| `UNFOLD_JOBS_REQUIRE_GATEWAY` | `false` for this production topology: the media worker does not plan edits |

Generate the encryption key directly into the protected web env, without printing it:

```sh
sudo python3 - <<'PY'
from pathlib import Path
import secrets
p = Path('/etc/unfold/web.env')
s = p.read_text()
placeholder = 'REPLACE_WITH_64_HEX_CHARACTERS'
if placeholder not in s:
    raise SystemExit('Refusing to overwrite an existing encryption key')
p.write_text(s.replace(placeholder, secrets.token_hex(32)))
p.chmod(0o600)
PY
```

Back this key up in a private secrets vault separately from the database. Replacing or losing it makes existing saved API keys unreadable. Do not add a shared `CEREBRAS_API_KEY` expecting it to fund production users: the implemented authenticated path requires each user to save a Cerebras key in Settings, then launches an isolated OpenClaw child. A platform-funded plan would need an explicit product/billing change.

### 4. Build and start the web/media services

The common env intentionally contains only public settings and non-secret host paths so the runtime user can read it for builds. The web/publishing secret files are readable by root/systemd, which passes their environment only to the required service. Do not source secret env files in a shell or pass a Node `--env-file` flag to Next itself.

```sh
cd /opt/unfold
sudo -u unfold env -i PATH=/usr/local/bin:/usr/bin:/bin LANG=C.UTF-8 \
  /usr/local/bin/node infra/deploy/build.mjs /etc/unfold/common.env
sudo install -m 0644 infra/systemd/unfold-{web,worker,publishing}.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now unfold-web unfold-worker
sudo systemctl status unfold-web unfold-worker --no-pager
```

The build helper validates public auth settings and all referenced audio files, clears only the generated Turbopack production cache and verifies the emitted layout-stability CSS. It uses `process.loadEnvFile` then a fresh Next child, avoiding the Node `NODE_OPTIONS` env-file re-exec failure seen during local setup. Public auth/site/job flags must be present **before** building; changing them requires a rebuild, not just a restart. Runtime secret changes require restarting the services that use them.

Install Caddy from its official Ubuntu repository, copy `infra/deploy/Caddyfile` to `/etc/caddy/Caddyfile`, validate it, then enable/reload Caddy. DNS must point at this server and ports 80/443 must be reachable for certificate issuance. This config needs Caddy 2.10+ for its body limit.

```sh
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl enable --now caddy
sudo systemctl reload caddy
curl -I https://unfold.maazx.dev
```

Caddy handles certificates and renewal. Do not add a static-file mapping for `/var/lib/unfold`, or cache authenticated `/app`, `/api`, `/settings`, `/media` or `/auth` responses at a CDN. Keep streaming enabled. The `/media` route performs ownership/capability checks and supports ranges; the private disk is not a public bucket.

### 5. Connect production accounts and enable the publishing worker

First sign in at the real production URL. Local fixed development identities are rejected in production; the previous `@penthoraa`/Pinterest local connections are not automatically the new account's connections. Connect Instagram/Pinterest from the app under the real signed-in account and let the human complete consent. The configured public origin supplies the return URL. Recheck any integration dashboard allow list/approved redirect domain, real managed-app availability and permission approval for customer accounts.

Instagram needs a supported Business/Creator identity and content-publish access. Pinterest's current connector requires all five scopes recorded in `infra/publishing-operations.md`, including `boards:write`, plus an actual owned board and permitted production API access. Do not infer public customer eligibility from one successful local test account. Native staged uploads do not need a tunnel or public disk exposure. Keep `UNFOLD_PUBLISHING_DELIVERY_ENABLED=0` for the preferred routes.

After the production connection/media flow is reviewable, set `UNFOLD_PUBLISHING_ENABLED=1` in the protected publishing env, then:

```sh
sudo systemctl restart unfold-web
sudo systemctl enable --now unfold-publishing
sudo systemctl status unfold-publishing --no-pager
```

All three units run a named-boolean preflight before starting. The publishing unit has a six-minute stop grace period for in-flight provider requests. A forced termination can leave an ambiguous publication which must be verified before another publish; never reset its ledger just to make Retry appear. The media unit runs confirmed-stop recovery and its deeper tool/storage readiness check before taking jobs.

### 6. Target-host acceptance before the demo

1. Use a real non-team customer email: receive the code/link, sign in, refresh and sign out. Signed-out APIs must reject access; a second signed-in account must not see the first account's projects, exports or destinations.
2. Save the user's Cerebras key; run the explicit access check, then actually generate an edit. A saved key or successful model-list check alone is not a generation test. Verify the installed isolated OpenClaw version/config starts and disposes its child correctly.
3. Upload real footage, analyze it, generate, inspect captions, export, reload while exporting and confirm exactly the same durable job reaches a playable MP4 with its review. Test Hindi/Auto separately if offering those modes.
4. From the app, inspect a completed MP4 and publish one explicitly approved test to each production-connected identity. Verify both final platform IDs/links and native video playback.
5. Schedule a second explicitly approved test at least five minutes ahead with the visible timezone. Close the browser **before** it is due. Verify a healthy worker heartbeat and compare the first dispatch time with stored UTC `dueAt`, then verify final publication links/playback. Upload and platform transcoding start at dispatch, so the visible publication can occur after the selected time; current code does not pre-stage for an exact-second publish guarantee.
6. With another future schedule saved, restart the host and verify all three services return, the same schedule persists, and there is no duplicate public publish operation. Keep private sanitized receipts. Do not reuse the earlier delayed local run as target-host timing proof.

Useful operator commands:

```sh
sudo systemctl is-active unfold-web unfold-worker unfold-publishing caddy
sudo journalctl -u unfold-web -u unfold-worker -u unfold-publishing --since '10 minutes ago' --no-pager
# Load non-secret common env for a CLI health check, without shell sourcing:
sudo -u unfold /usr/local/bin/node --env-file=/etc/unfold/common.env \
  --import /opt/unfold/packages/video/node_modules/tsx/dist/loader.mjs \
  /opt/unfold/services/jobs/scripts/health.ts --require-worker
```

Keep logs private; do not paste raw URLs with auth/media tokens or provider response bodies. Configure disk/worker-heartbeat alerts and an external HTTPS uptime check. Maintain at least the configured 5 GiB free reserve plus upload/render headroom. Add encrypted off-host backups of `/var/lib/unfold` and protect the encryption key separately. For an application-consistent filesystem backup, stop/drain all three writer services first, capture the databases/WAL and project files together, then restart. A live `cp` of one SQLite file is not a valid backup method. Supabase's database backup is separate and does not back up local videos or these SQLite queues.

For code updates, drain publishing before changing the checkout, stop web/media writers, take a backup, install the locked dependencies and complete library, rebuild with the correct public env, then restart the three units. Do not rebuild in the same `.next` directory while the production web process serves it. Keep the previous code/build release available; do not downgrade an incompatible database schema. Public model/provider availability, the production auth flow, Linux rendering and delivery timing still need the actual target-host acceptance above.

Official references: [Hetzner resources](https://docs.hetzner.com/cloud/servers/faq/), [Supabase redirect configuration](https://supabase.com/docs/guides/auth/redirect-urls), [SMTP requirements](https://supabase.com/docs/guides/auth/auth-smtp), [OpenClaw Node requirements](https://docs.openclaw.ai/install/node), [Remotion browser provisioning](https://www.remotion.dev/docs/cli/browser/ensure), [Chrome dependencies](https://www.remotion.dev/docs/docker), [Caddy automatic HTTPS](https://caddyserver.com/docs/automatic-https). Check [Remotion's license and pricing](https://www.remotion.dev/docs/license) against the intended automated SaaS use before choosing the final operating budget.
