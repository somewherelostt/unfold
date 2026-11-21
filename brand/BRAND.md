# Unfold brand guidelines

Unfold turns one raw clip into many viral edits, instantly. The brand should feel like **creator energy with pro-tool calm**: the product UI is quiet and precise, the outputs (captions, thumbnails, demo) are loud.

## Name and voice
- Name: **Unfold** (wordmark is lowercase `unfold`; in sentences write "Unfold").
- Headline: "Turn one clip into every version that could go viral."
- X / demo line: "One raw clip. Nine viral edits. Four seconds."
- Voice: short, verb-led, second person, sentence case. Periods, no exclamation marks. Numbers carry the claims ("9 edits · 4.8s").
- Words we use: clip, edit, variant, hook, beat, caption, remix. Avoid: "magic", "revolutionary", "AI-powered" in headlines.

## Logo
- Mark: three stacked, offset rounded rectangles fanning out from one corner: one clip unfolding into variants. Files: `logo-mark.svg`, `logo.svg` (mark + wordmark).
- Wordmark: `unfold` in the display face at 800, tracking −3%.
- Clear space: the height of the mark's smallest rectangle on all sides. Min size: mark 20px, full logo 88px wide.
- On dark backgrounds use the light variant (ink → white); never recolor the Flare layer.

## Colour
| Token | Light | Dark | Use |
|---|---|---|---|
| `--bg` | #FAFAF7 | #0C0C0E | page background |
| `--surface` | #FFFFFF | #151518 | cards, panels |
| `--surface-2` | #F3F2EE | #1D1D21 | inputs, chips, timeline bed |
| `--border` | #E6E4DE | #2A2A30 | hairlines |
| `--ink` | #0B0B0C | #F5F5F2 | primary text |
| `--ink-muted` | #6A6A70 | #9A9AA3 | secondary text |
| `--flare` | #FF5A1F | #FF6A33 | **brand accent**, primary buttons, focus, speed stats |
| `--flare-ink` | #FFFFFF | #0C0C0E | text on flare |
| `--violet` | #7B5CFF | #8F75FF | secondary accent, agent/AI moments |
| `--caption-yellow` | #FFE14D | #FFE14D | viral caption highlight, emphasis words |
| `--success` | #18B26B | #2BD27F | done states |
| `--danger` | #E5484D | #FF6369 | errors |

Timeline track colours (same in both themes): video `#3A3A40`, captions `#7B5CFF`, music `#2F80ED` (beat markers `#9CC3FF`), SFX `#FF4FA3`, transitions `#FFB020`, zoom `#18B26B`.

Gradient (hero, demo end card only): `linear-gradient(135deg, #FF5A1F 0%, #FF4FA3 50%, #7B5CFF 100%)`.

Why: Flare echoes Cerebras orange; violet marks the agent; caption yellow is the colour of viral captions.

## Typography
| Role | Font | Weights | Notes |
|---|---|---|---|
| Display | display face (`--font-display-face`): expressive grotesque | 700, 800 | headlines, logo, big numbers |
| UI / body | UI face (`--font-ui`): neutral grotesque | 400, 500, 600 | everything in the product |
| Mono | mono face (`--font-ui-mono`) | 500 | speed stats, timecodes, TPS |

Scale (px / line-height / tracking):
- display-xl 72/76/−3% (hero) · display-l 56/60/−2.5% · display-m 40/44/−2%
- h1 32/38/−1.5% · h2 24/30/−1% · h3 18/24/−0.5%
- body 15/24/0 · small 13/20/0 · micro 11/16/+2% uppercase (labels)
- mono-stat 14/20/0, tabular numbers

In-video caption faces (loaded by packages/video): condensed heavy sans (bold-pop), geometric black sans (clean-pop), comic display (meme), rounded heavy sans (story). Captions: white fill, 6–8px black stroke, emphasis word in caption yellow or flare, 1–3 words per beat.

## Shape, depth, motion
- Radius: 8 (chips, inputs) · 12 (buttons) · 16 (cards, panels) · 24 (modals, phone frames) · full (pills).
- Shadow: `0 1px 2px rgb(0 0 0 / .06), 0 8px 24px rgb(0 0 0 / .06)` for floating toolbars and modals only; panels use borders.
- Spacing: 4px grid; panel padding 16; section padding 96 (desktop) / 56 (mobile).
- Motion: 120ms ease-out for UI, 240ms spring for panels; "unfold" reveal (cards fanning from one corner, 40ms stagger) for variants and the logo.

## Components (product)
- Primary button: flare fill, flare-ink text, radius 12, height 40. Secondary: surface + border. Ghost: text only.
- Speed badge: mono, `⚡ 0.8s · 1,100 TPS`, violet text on violet/10% background, pill.
- Chips: surface-2, radius 8, 13px; selected = ink fill, white text.
- Phone frame (variants grid): 9:16, radius 24, 1px border, hover plays muted.

## Demo video and social
- 9:16 or 16:9, ≤60s. Open on the raw clip, then the unfold reveal into the 3×3 grid with the speed counter in the mono face.
- End card: gradient background, `unfold` wordmark, "Built with Kimi K3.1 Pro on Cerebras · OpenClaw", #KimiOnCerebras.
