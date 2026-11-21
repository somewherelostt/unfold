# Unfold

Turn one clip into every version that could go viral.

Upload a raw clip. An OpenClaw agent running **Kimi K3.1 Pro on Cerebras** decides the hook, the cuts, word-by-word captions, a beat-synced music track, transitions and meme sound effects, and returns nine different edits in seconds. Chat to remix any of them, or paste an inspiration video and Unfold copies its style.

## How it works
```
raw clip ──► media pipeline (transcript with word timings, scenes, frames, loudness)
                              │
asset library (music with beat grids, SFX) ──┤
                              ▼
        OpenClaw agent · Kimi K3.1 Pro on Cerebras
        writes an AgentPlan (JSON) per variant, 9 in parallel
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
cp .env.example .env                                  # fill in values yourself
openclaw --profile unfold gateway run --port 18890   # see agent-workspace/README.md
pnpm dev
```
