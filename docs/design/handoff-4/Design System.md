# Skitza — Design System

A calm, boutique app where an artist books and pays a music producer. Feeling: **warm, premium, unhurried — "a quiet record shop," not a SaaS dashboard.** Mobile-first (iPhone, 390×844pt design frame). One clear primary action per screen.

---

## 1. Color

All colors are warm-biased. Defined as CSS custom properties in `tokens.css` and referenced as `rgb(var(--token) / <alpha>)`.

| Role                           | Value                              | Notes                                                              |
| ------------------------------ | ---------------------------------- | ------------------------------------------------------------------ |
| Canvas / page                  | `#F7F3EC` (`rgb(247 243 236)`)     | warm cream — the app background                                    |
| Card / input surface           | `#FFFFFF`                          | white                                                              |
| Dark surface / chrome          | `#111009`                          | near-black, warm. Used for amount cards, contracts, summary strips |
| Sunken / subtle fill           | `#E8E1D4`                          |                                                                    |
| Text strong (headings)         | `#111009`                          |                                                                    |
| Text body                      | `#3D3730` (`rgb(61 55 48)`)        |                                                                    |
| Text muted                     | `#6B6359` (`var(--fg-muted)`)      |                                                                    |
| Text faint / hints             | `#9C948A`                          |                                                                    |
| Text on dark                   | `#F2EDE6`                          |                                                                    |
| **Brand amber (primary)**      | `#D4960A` (`var(--brand-primary)`) | main CTA, highlights, links, selected rings                        |
| Amber dark (press/link text)   | `#A17106` / `rgb(140 95 6)`        | the readable amber for text on cream                               |
| Copper (secondary)             | `#B06830`                          |                                                                    |
| Success / unlocked / confirmed | `#22C55E`                          | green pills, paid states, stepper done                             |
| Warning / pending              | `#F59E0B`                          | amber pill dot, held states                                        |
| Danger / blocked / rejected    | `#DC2626`                          |                                                                    |
| Border subtle                  | `#E8E1D4` (`var(--border-subtle)`) | hairlines, card borders                                            |
| Border strong                  | `#C8C0B2`                          | inputs, dashed empty states                                        |

**Cover art** is generated, not photographic (placeholder system — swap for real imagery later). `skCover(hue)` = a vignette radial-gradient over a 3-stop `oklch` linear gradient; `skSwatch(hue)` = a 2-stop gradient for avatars. Each product has a distinct hue (g1 = 44 amber, g2 = 30 terracotta, g3 = 12 red, g4 = 340 magenta) so the store scans like a record shelf.

---

## 2. Type

Loaded from Google Fonts. `font-variant-numeric: tabular-nums` globally so figures align.

- **Syne** (700/800) — display: screen titles, prices, producer/product names. Tight tracking (`-0.02em` to `-0.04em`).
- **Outfit** (400–700) — body & UI: everything else.
- **JetBrains Mono** (500–700) — numbers, amounts, timestamps, eyebrows/labels. Uppercase eyebrows use `letter-spacing: 0.14–0.18em`.

**Scale (mobile):** screen title 26–31px · section/card title 16–24px · body 13–15px · eyebrow/label 9–11px mono. Big prices 27–46px Syne. Never below ~10px.

**Eyebrow pattern** (recurring): mono, 10px, uppercase, `0.16em` tracking, muted or amber (`gold`), often prefixed with an 18×1px rule line. Drives the eyebrow → title → body rhythm on every screen.

---

## 3. Shape, depth, spacing

- **Radius:** 16px default. Scale: 8 / 12 / 14 / 16 / 18 / 20 / 22 / 28. `rounded-full` (999px) ONLY for circular things — avatars, icon buttons, dots, play buttons, pills. Never on text rectangles.
- **Gutters:** 20px horizontal page padding throughout. Sections stack at ~16–22px vertical rhythm.
- **Shadows** (soft, warm, never gray):
  - small `0 1px 2px rgba(17,16,9,.04)`
  - medium `0 4px 12px -4px rgba(17,16,9,.3)` (lifted thumbnails)
  - large `0 18px–24px 44px -24px rgba(17,16,9,.3)` (hero cards)
  - amber glow on the key CTA: `0 0 0 4px rgb(var(--brand-primary)/.16), 0 14px 30px -10px rgb(var(--brand-primary)/.7)`

---

## 4. Motion

Quiet and physical. Defined in `tokens.css` + the host HTML `<style>`.

- **Entrances:** staggered fade-rise on screen mount — `sk-rise .55s cubic-bezier(.16,1,.3,1)`, children delayed in sequence. Gated so print/reduced-motion show end-state.
- **Press liveness (JS-driven, in the host file):** crisp scale-down on `pointerdown` (`.93` buttons, `.965` cards, `.975` rows), springy overshoot release (`cubic-bezier(.34,1.56,.64,1)`). Applied via inline transform so it beats the buttons' `all:unset`.
- **CTA sheen:** a slow periodic highlight sweep across the primary button.
- **Ambient:** breathing status dots (pending), stepper ring pulse, equalizer bars on playing tracks, confirmation ripple (S5). No bounce-heavy or infinite decorative loops on content.

---

## 5. Components

- **Primary button** — amber fill, `#1a1407` text, 16px radius, full-width at screen bottom on funnel screens; optional mono sub-label; disabled = muted fill + short reason line.
- **Secondary button** — white fill, strong border, dark text.
- **Card** — white, 16–20px radius, 1px subtle border, small shadow, ~16–20px padding.
- **Status pill** (`StatusPill`) — pending = warning-amber tint (breathing dot), ok = green, danger = red, neutral = grey.
- **Chip** — small mono tag; tones: amber, dark, ok, plain.
- **Avatar** — gradient square (squircle) or circle, initials, optional ring.
- **Stepper** (S6) — 4-node journey Request → Pay → Sessions → Delivered; done = green check, active = amber pulsing, declined = red “!”.
- **TopBar** — pinned solid header for funnel screens (back arrow + centered title + mono sub).
- **StickyNav** — collapsing header for standing screens: transparent over the cover, fades to a solid cream bar (with title) on scroll so the iOS status bar always rests on a clean background.
- **Bottom tab bar** — Home · Music · Book · Store · Settings; active in amber. Present on standing screens only; navigates via `onNav`.
- **Calendar** (S10) — month grid, weekday header, availability dots, past/unavailable days greyed + non-interactive, month nav, legend.

---

## 6. Navigation model

- **Funnel** (sign-in → store → purchase → pay → book): focused flow — back arrow top-left, **no** bottom tab bar, primary action low/thumb-reachable.
- **Standing screens** (Home, Music, Book, Store, Settings): bottom tab bar visible.

---

## 7. Required states

Every screen with data/actions designs: **Loading** (warm skeletons, not spinners), **Empty** (one friendly line + the single action), **Error/Rejected** (inline, calm, retry), **Disabled** (explain why in one line). v2 features appear as greyed "Coming soon," never removed.
