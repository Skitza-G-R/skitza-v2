# v5 — "The Money Cut" production plan

> **Status: implemented.** `record-v5.mjs` + `scenes-v5.js` + `teaser-v5.html` +
> `timeline-v5.json` / `timeline-v5-30.json`. Defaults taken on the owner items:
> no b-roll (slots collapsed), no proof beat, 100 BPM. One correction from the
> plan: the cutdown's originally listed beat sum was wrong; the shipped cutdown
> is hook 3.6 + turn 4.2 + book 2.4 + agree 2.4 + verify 5.4 + payoff 6.0 +
> CTA 6.0 = exactly 30.0s, and the master lands at 40.8s.

Everything from the critique (see the end of RESEARCH.md history / session notes),
turned into one build. Thesis: the film currently explains seven things politely;
v5 makes **one promise — "you get paid"** — and uses everything else as evidence.

## The new spine

All cuts stay on the 0.6s grid (100 BPM). Master ≈ 42.0s (45.6s if b-roll ships).

| t | beat | what changes vs v4 |
|---|------|--------------------|
| 0.0–3.6 | **Hook** | Badge ticks from the first frames (motion in frame 1). Bubbles reordered to crescendo on money: version q → stems → scheduling → "did my transfer arrive??" → freeze on **"i'll pay after the session, promise"** → slam. |
| 3.6–8.4 | **Turn** | Headline becomes the thesis: **"One link gets you paid."** URL types; store card is *alive* (real hover lift on the focal card). |
| 8.4–15.6 | **Artist montage** | Book → agree → upload proof as three quick 2.4s micro-beats (montage energy, copper chip persists). Real interactions: day-card tap reveals real slots; agreement scrolls then taps; proof CTA press state. |
| 15.6–21.0 | **Verify (macro)** | Composition break #1: extreme close-up push on **Confirm ₪1,200**, real hover state, click, success flash. |
| 21.0–26.4 | **Locked** | Composition break #2: open *inside* the live waveform (playhead genuinely moving), pull back to reveal the page — "Download locked until full payment · ₪1,200 remaining" — notes rail visible as texture. |
| 26.4–33.0 | **Payoff** | ₪1,200 → ₪0 dissolve, giant ₪2,400 verified, unlock. Longest hold in the film. |
| 33.0–35.4 | **Proof (conditional)** | One true number from the beta, only if one exists. No number → beat does not exist. |
| →42.0 | **CTA** | Unchanged pair + tag + wordmark + `skitza.app` (a `--cta="Request access"` toggle is built but off, per your call). |

Persistent micro-wordmark `skitza.` top corner from 3.6s onward (~35% opacity) in both cuts.

**30s cutdown** (feeds): hook 3.6 + turn 3.6 + book 2.4 + agree 2.4 + verify 4.8 +
payoff 5.4 + CTA 5.4 = **30.0s exactly**, same assets, second timeline file.

Deliverables: 4 MP4s (42s and 30s × 16:9 and 9:16) + the SFX stem + a stills strip
for the silent-watch check.

## Living UI — how, honestly

New `record-v5.mjs` drives each real dev screen in Playwright on a scripted
schedule (hover, scroll, tap, dropdown), captures the interaction as a frame
sequence, and the film engine plays sequences inside the cards (`seqCard`,
falling back to the still where no sequence exists).

Constraints stated up front:

- **Interactions that stay client-side are recorded for real** (booking day
  select, scrolls, hovers, dropdowns, press states). Anything that fires a
  tRPC mutation (Confirm, Accept) is captured up to the press — hover + press
  state are real, the ripple stays ours, and no fake post-state is invented;
  the following beat carries the real after-state capture, as today.
- **The waveform playhead** needs loadable audio: the sk217 fixture's
  `audioUrl` points at a non-audio path, so the plan patches the *dev fixture
  only* to a small data-URI WAV so wavesurfer genuinely plays. Same commit
  class as the earlier sk217 fixture change; same Linear backfill note.

## Fix map (critique → action → owner)

| # | Critique | v5 action | Owner |
|---|----------|-----------|-------|
| 1 | Dead UI | `record-v5.mjs` + `seqCard`; every product beat carries ≥1 genuine product motion | me |
| 2 | Seven promises | Money spine above; artist beats compressed to a montage; money arc ≈ 70% of product runtime | me |
| 3 | No humans | Three 0.8–1.2s b-roll slots (into turn, into verify, into payoff). **Needs your clips** — 3–5 phone clips, 1–2s each, studio hands/faders/screens, landscape + safe for vertical crop. Film builds with or without them. | you |
| 4 | Metronomic rhythm | Montage burst + macro verify + inside-the-waveform open; the rest stays on grid so the breaks read intentional | me |
| 5 | Late brand | Persistent micro-wordmark from 3.6s | me |
| 6 | No proof | Conditional beat; **needs one true number** or it's skipped | you |
| 7 | Passive CTA | Stays `skitza.app` (your call); honest-verb variant built behind a flag | decided |
| 8 | Length vs placement | 42s master + 30.0s cutdown from the same assets | me |
| 9 | Hook order | Money-last bubble order + first-frame badge motion | me |

## QA gates (added to the existing ones)

1. Every product beat shows real product motion — verified on moment frames.
2. Frame 1 contains motion (badge tick).
3. Silent-watch test on the stills strip: offer + who's-who + CTA legible with no audio.
4. Money arc ≥ 55% of product-beat runtime (currently plans to ~70%).
5. All v4 gates: autofit headlines, complete crops, one data world, luma structure, A/V mux integrity.

## What I need from you before the final master

1. **B-roll or explicit "skip"** (film renders either way).
2. **One true beta number, or "skip".**
3. **Track BPM** — the grid is authored at 100; a different BPM means I re-author the grid, so say the number before the final renders.
4. Green light.

Estimated wall time on go: recording + composition ≈ 2–3 h of iterations, then
~1 h of renders for all four outputs.
