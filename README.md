# Unfold

Raw footage in. Viral edit out.

Upload a raw clip. An OpenClaw agent running **Kimi K3.1 Pro on Cerebras** decides the hook, the cuts, styled word-by-word captions, a beat-synced music track, transitions and sound effects, and returns a finished edit in seconds. Chat to change anything, paste an inspiration video to copy its style, or try a few alternate versions.

## How it works
```
raw clip ──► media pipeline (transcript with word timings, scenes, frames, loudness)
                              │
asset library (music with beat grids, SFX) ──┤
                              ▼
        OpenClaw agent · Kimi K3.1 Pro on Cerebras
        writes an AgentPlan (JSON): hook, cuts, captions, music, transitions, SFX
                              ▼
        compileEditPlan(): maps source time to output time, snaps cuts to beats, builds caption chunks
                              ▼
        EditPlan → in-browser preview → MP4 export
```

## Layout
```
apps/web            Web app: landing page, product UI, API routes
packages/core       Data contract (MediaAnalysis, AgentPlan, EditPlan) + compileEditPlan() + fixtures
packages/agent      OpenClaw/Kimi agent: prompts, variants, remix, style copy
packages/video      Video composition that renders an EditPlan (preview + export)
services/media      Media pipeline and asset-library tooling
agent-workspace     The OpenClaw agent's instructions
brand               Brand guidelines, tokens, logo
```

## Run locally
```bash
pnpm install
cp .env.example apps/web/.env.local                   # fill in values yourself
openclaw --profile unfold gateway run --port 18890   # see agent-workspace/README.md
pnpm dev
```

The app reads environment variables from `apps/web/.env.local`. For the local demo, use `UNFOLD_DEV_NO_AUTH=1`; real email sign-in setup is documented in `db/README.md`. Editing uses the configured OpenClaw gateway.

The landing leads into a single edit. Attach a clip, choose a caption style and aspect ratio, then refine the result in the dark editor. Export uses the currently previewed edit, including manual changes, at 720p or 1080p, with an optional caption burn-in. Alternate versions stay in the editor drawer.
