#!/usr/bin/env bash
# One-time setup for services/media: system tools, speech-to-text model, Python venv for music analysis.
# Download URLs live in the gitignored library/sources.local.env (STT_MODEL_URL=...).
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f library/sources.local.env ] && . library/sources.local.env
command -v brew >/dev/null || { echo "need the 'brew' package manager (or install ffmpeg, the video downloader, the STT CLI and uv yourself)"; exit 1; }
for f in ffmpeg yt-dlp whisper-cpp uv; do brew list --formula "$f" >/dev/null 2>&1 || brew install "$f"; done
mkdir -p models
if [ ! -f models/ggml-base.en.bin ]; then
  : "${STT_MODEL_URL:?set STT_MODEL_URL (base.en ggml model) in library/sources.local.env}"
  curl -L --fail -o models/ggml-base.en.bin "$STT_MODEL_URL"
fi
# Python 3.12 venv (the numeric JIT has no 3.15 wheels; its newest release segfaults here, so it's pinned in requirements.txt).
[ -x .venv/bin/python ] || uv venv --python 3.12 .venv
uv pip install --python .venv/bin/python -r requirements.txt
echo "ok: try  bun src/cli.ts analyze ../../apps/web/public/demo/sample.mp4"
