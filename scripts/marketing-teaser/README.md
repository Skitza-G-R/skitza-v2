# Marketing teaser generator

**Read `RESEARCH.md` first** — it holds the conversion research this film's
structure follows (3-second pain hook, story arc, benefit-framed beats,
oversized silent-safe type, measured crops, CTA last) and maps each finding
to a decision in `scenes-v3.js` + `timeline-v3.json`.

Renders the Skitza product teaser as an MP4 — in 16:9 and 9:16 — from **real
screenshots of the running app**, not mockups. Every product beat is a capture
of a `/dev/screens/<key>` gallery route, so the film stays honest: when the UI
changes, re-run the capture step and the teaser updates with it.

## Why it looks the way it does

- **Real components.** The nine product beats are screenshots of actual dev
  gallery screens. Only the open and close title cards are drawn, because no
  product screen is a title card.
- **Genuine state changes.** Where the story shows something changing, it
  cross-dissolves between two real captures of the two real states
  (`sk94-artist-ready` → `sk94-artist-approved`, `s9-partial` → `s9-paid`).
  Nothing is faked with CSS.
- **Measured click targets.** Cursor positions come from
  `getBoundingClientRect()` on the live DOM, stored in `targets*.json` — so the
  pointer lands on the real button, not a guessed coordinate.
- **Deterministic frames.** Nothing uses wall-clock time or CSS animation.
  Every visual is a pure function of `t`, so output is identical regardless of
  how loaded the machine is.

## Requirements

Node 22 + pnpm, Python 3 with `numpy` and `imageio-ffmpeg` (the latter supplies
a full ffmpeg with x264 and AAC — Playwright's bundled ffmpeg is VP8-video-only
and cannot mux audio).

```bash
pip install numpy imageio-ffmpeg
```

## Pipeline

```bash
# 1. Boot the app. No secrets needed: Clerk runs keyless in dev, the dev
#    gallery gate only needs NODE_ENV=development, and the link-only access
#    gate is inert while ACCESS_TOKEN is unset.
cd apps/web && NODE_ENV=development npx next dev --port 3000

# 2. Capture. Screens, story-world rewrites, element rects and click targets
#    all live in capture-v3.mjs (SHOTS + REWRITES). It waits out React
#    hydration and re-applies the rewrites until they stick, then writes
#    v3-desktop/, v3-mobile/ and v3-rects.json.
node capture-v3.mjs

# 3. Sound: synthesized UI cues (A-minor pentatonic) on the film's cue map.
python3 sound.py timeline-v3.json sfx-v3.wav

# 4. Render. --mblur=N renders N sub-frames per output frame and averages
#    them in ffmpeg (tmix) — that is the motion blur.
node render2.mjs --mode=wide --html=teaser-v3.html --timeline=timeline-v3.json --mblur=3 --out=v3-wide.mp4
node render2.mjs --mode=tall --html=teaser-v3.html --timeline=timeline-v3.json --mblur=3 --out=v3-tall.mp4

# 5. Mux picture and sound.
ffmpeg -i v3-wide.mp4 -i sfx-v3.wav -c:v copy -c:a aac -b:a 192k -shortest teaser-16x9.mp4

# Spot-check any moment without a full render:
node check-v3.mjs 2.62 17.30          # frames at those times (add --tall for 9:16)
```

The film sits on a **100 BPM grid** (0.6s per beat; every cut lands on it),
so ask for / produce the music bed at 100 BPM and it locks to the edit.

`--stills` renders one frame per beat instead of the full film — the fast way
to check composition after an edit.

## Adding the music bed

`sfx.wav` is a **sound-effects stem only**, mixed to sit under a track: peak
about -3 dBFS, and roughly 69% of its duration is near-silent. Drop the music
in underneath and duck it slightly beneath the UI cues:

```bash
ffmpeg -i real-wide.mp4 -i sfx.wav -i music.wav \
  -filter_complex "[2:a]volume=0.55[m];[1:a][m]amix=inputs=2:duration=first[a]" \
  -map 0:v -map "[a]" -c:v copy -c:a aac -b:a 192k -shortest teaser.mp4
```

## Files

| File | Purpose |
|---|---|
| `RESEARCH.md` | The conversion research and the decision each finding produced |
| `teaser-v3.html` | Stage, Skitza tokens, deterministic render engine |
| `scenes-v3.js` | Hook / turn / four benefit beats / payoff / CTA; measured-crop cards, kinetic headlines |
| `timeline-v3.json` | Beat timings and sound cues on the 100 BPM grid — picture and sound share it so they cannot drift |
| `render2.mjs` | Playwright → ffmpeg frame pipeline, motion blur, stills mode, rect injection |
| `capture-v3.mjs` | Captures the current-component gallery screens; enforces the one-story-world rewrites (hydration-safe), records element rects + click targets |
| `check-v3.mjs` | Renders single frames at given times for review |
| `sound.py` | Synthesizes the UI sound stem for a given timeline |
| `fonts/` | Syne, Outfit, JetBrains Mono, subset locally so renders need no network |

## Caveats

- The payment-evidence image in `gate2-review` lives in R2 and cannot load
  without credentials, so `capture.mjs` substitutes a generic, deliberately
  unbranded transfer-confirmation graphic. It carries no bank or payment-app
  identity; if you would rather show a real receipt, replace `RECEIPT` there.
- Clicking a real button in the gallery does not advance state — those
  mutations need a database — which is why state changes use captured
  lifecycle pairs instead.
- Captures and rendered MP4s are intentionally not committed; both are
  regenerated by the steps above.
