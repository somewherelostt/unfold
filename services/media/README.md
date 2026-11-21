# services/media

Unfold's media pipeline and asset library. It turns an uploaded video into a `MediaAnalysis` (the contract in `packages/core/src/schema.ts`). It can also fetch an inspiration video from a link and add cut-rate stats.

## Setup

```bash
bash services/media/scripts/setup.sh
```

The setup script installs:
- the system tools: video toolkit, video downloader, local speech-to-text CLI, Python env manager
- the English base speech-to-text model (about 148 MB, into `models/`)
- a Python 3.12 venv for music analysis (`.venv/`)

`models/` and `.venv/` are gitignored, and so are `library/*.local.tsv` and `library/*.local.env`. The model download URL is read from `library/sources.local.env`.

## Use

```bash
cd services/media
bun src/cli.ts analyze <video> [--id <videoId>] [--out analysis.json]
bun src/cli.ts reference <url | local-file> [--id <id>]   # fetch link + analysis + cut stats
bun src/cli.ts library                                   # validate the manifests and summarise them
bun src/validate.ts ../../data/media/*/analysis.json     # schema-validate analyses and both manifests
```

`node src/cli.ts ...` also works (node ≥ 23 strips the types natively).

From code, for example in an API route:

```ts
import { analyzeVideo, fetchReference, analyzeReferenceFile, loadLibrary, frameUrlToPath } from "<repo>/services/media/src/index.ts";

const { analysis, timings } = await analyzeVideo("/path/to/upload.mov", { videoId });
const ref = await fetchReference("https://<video link>");            // { analysis, stats: { cutsPerMinute, avgShotSec, ... }, title }
const ref2 = await analyzeReferenceFile("/path/to/uploaded-ref.mp4"); // fallback when a link can't be fetched
const { music, sfx } = await loadLibrary();                          // validated MusicTrack[] / SfxItem[]
const jpegPath = frameUrlToPath(analysis.frames[0].url);             // local path, for sending frames to Kimi as images
```

Environment overrides:
- `UNFOLD_DATA_DIR`, `UNFOLD_MEDIA_URL_PREFIX`: output folder and URL prefix
- `UNFOLD_STT_BIN`, `UNFOLD_STT_MODEL`: speech-to-text CLI and model path
- `UNFOLD_DOWNLOADER_BIN`: video downloader binary
- `FFMPEG_PATH`, `FFPROBE_PATH`: video toolkit binaries

### Output layout

`<repo>/data/media/<videoId>/` (repo-root `data/` is gitignored):

| file | what |
|---|---|
| `source.mp4` | proxy: H.264, short side ≤ 1080, ≤ 60 fps, AAC, `+faststart`. Remuxed with no re-encode when the upload already qualifies |
| `frames/f_<t>.jpg` | up to 16 stills, long side 512px: one every ~2s plus each scene start (scene starts take priority) |
| `transcript.json` | raw speech-to-text output |
| `analysis.json` | the `MediaAnalysis` |

URLs in the analysis are `/media/<videoId>/...`. The web app serves `data/media` at `/media` (`apps/web/src/app/media/[...path]/route.ts`). References are written to `data/media/ref-<id>/` and keep their original container: `src` points at `input.webm|mp4` and no proxy is made.

### Pipeline

After the probe (about 30 ms), these steps all read the original file **in parallel**:

- **proxy**: hardware H.264 encoder at 8 Mb/s, falling back to the software x264 `veryfast` preset.
- **transcript**: 16 kHz mono WAV → local speech-to-text, base English model on the GPU, one word per segment. Parenthesised or bracketed non-speech output such as `(music)` is dropped. Stray punctuation is merged into the previous word. A word's duration is capped by its length and anchored at its end time, because the model stretches the first word over leading silence. `hasSpeech` requires at least 4 words and real speech density, so gameplay or music-only clips get `hasSpeech:false, words:[]`.
- **scenes**: `select=gt(scene,0.3)` on a 160px hardware-accelerated decode. Clips over 20s are split into up to 8 chunks decoded in parallel. Shots shorter than 0.4s are merged.
- **loudness**: `astats` RMS over 2000-sample windows at 8 kHz, which gives a 4 Hz `{t, db}` envelope (silence is -90).
- **frames**: start once scenes are known. One fast-seek extraction per frame, all in parallel.

`fetchReference` downloads mp4 at up to 1080p, first 180s only, from any link the video downloader supports (the major short-form platforms, video sites and direct links). It then runs the same analysis without a proxy and adds `stats`: `shots`, `cuts`, `cutsPerMinute`, `avgShotSec`, `medianShotSec`, `speechRatio`, `meanDb`, `dbStdDev`.

## Timings measured (dev laptop; ms)

| clip | proxy | transcript | scenes | frames | loudness | **total** |
|---|---|---|---|---|---|---|
| `demo/sample.mp4`: 20s 1080×1920 H.264, music, no speech | 528 (remux) | 3322 | 1528 | 755 | 63 | **3.4s** |
| public-domain speech clip: 54s 1280×720 VP8, 127 words | 4630 (hw) | 2431 | 792 | 535 | 679 | **4.7s** |
| 60s 1080×1920 **HEVC** phone-style upload, speech, 19 cuts | 9102 (hw) | 4116 | 2483 | 758 | 148 | **9.1s** |
| 13s 4-shot montage (cuts at 4/7/10s, all detected exactly), as reference | none | 962 | 693 | 231 | 55 | **1.0s** |
| Reference fetched from a link: 3 min 1080p60 VP9 | none | 3988 | 12192 | 1445 | 367 | **13.7s** + 26s download |

On a 60s clip the proxy transcode sets the total. Every other step finishes within about 4s. Speech-to-text on music-only audio is slower than on speech.

## Asset library

Both manifests are built from source lists that are kept **locally and gitignored** (`library/music-sources.local.tsv`, `library/sfx-sources.local.tsv`). Those lists hold the original page links, download paths and per-track licence flags. Committed data has none of them.

- `apps/web/public/assets/music/<id>.mp3` and `manifest.json` (`MusicTrack[]`, 32 tracks, `source: "library"`, `sourceUrl: ""`)
- `apps/web/public/assets/sfx/<id>.mp3` and `manifest.json` (`SfxItem[]`, 34 sounds, `source: "library"`)

```bash
pnpm --dir services/media build:music   # bpm, beats, downbeats, dropAt, energy  (~5s for 32 tracks)
pnpm --dir services/media build:sfx     # durations + tags
```

**Music analysis** (`scripts/analyze_music.py`):
- **BPM and beats**: a dynamic-programming beat tracker, folded into the 75–165 range, with the beat grid doubled or halved to match.
- **Downbeats**: every 4th beat, with the phase that has the most bass energy (under 200 Hz).
- **dropAt**: the biggest rise in RMS energy over 4s, ignoring the first 3s and last 5s, snapped to the nearest downbeat.
- **energy**: 0..1, a blend of loudness, onset density and tempo.

MP3s are 128 kb/s (music is 52 MB in total). SFX are trimmed of leading and trailing silence.

Coverage by mood: hype 14, dark 10, story 9, chill 6, funny 5, quirky 5, suspense 5, energetic 4, epic 3, emotional 3, aggressive 3, happy 3, tension 3, dramatic 2, sad 2. BPM ranges from 86 to 144.

SFX cover boom/impact ×2, thud ×2, whoosh ×3, riser ×2, record and DJ scratch, ding ×2, oof ×2, sad trombone, fail trumpet, crowd laugh ×2, evil laugh, airhorn ×2, camera shutter, pop ×2, glitch ×2, cash register, wow, kids "woah", applause, boing, wrong buzzer, and 8-bit error. All are original library uploads. There is no ripped meme audio.

### Licences / sources

- **Music and SFX**: everything comes from a royalty-free stock library whose licence allows free commercial use in videos with no attribution. `artist` holds the composer's name. Source page links stay in the local source lists. Half the music tracks (16 of 32) are registered with a video platform's content-ID system. Using one can trigger an automatic claim, which the creator clears with that track's licence certificate. The local music list flags them, and the 16 unflagged tracks are the safest defaults.
- **Test clips**, kept in `data/test/` and not committed: two public-domain government speech videos from a public media archive.

## Notes / gotchas

- Python: the system only ships Python 3.15, so the venv uses 3.12. The numeric JIT library's newest release segfaults in beat tracking here, so `requirements.txt` pins an older version.
- The code imports `packages/core/src/schema.ts` by relative path, so this package needs no install step of its own.
- The speech-to-text model loads in about 0.2s on the GPU. For more accuracy at some cost in speed, point `UNFOLD_STT_MODEL` at a small English model.
