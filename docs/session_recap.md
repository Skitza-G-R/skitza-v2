# Session Recap

> **For the next session: READ THIS FIRST.**
> Last updated: **2026-06-11, mobile funnel passes** — SK-50 artist mobile (#173), SK-51 landing mobile (#174), SK-52 auth mobile (#175); all driven by Gili's /goal: first impression on a phone = premium, Spotify-level.

## Where things stand

### SK-51 + SK-52 — landing + auth mobile premium pass (PR #174 / PR #175 MERGED)

Gili's phone screenshot showed the homepage broken on mobile (zoomed, cut off both edges, cream gutter on the right). Audited at a true 390px viewport with a CDP probe (`/tmp/sk51/audit.mjs`):

- **Root cause**: the page scrolls inside `.landing-v3-root` (overflow-y:auto), and the hero product-peek mock (fixed 156px fake sidebar + 3-col stats, min-content ≈ 422px) stretched the hero grid track to 422px → host scrollWidth 422 on a 390 screen → whole page panned sideways. The `sk-reveal-left/right` ±22px X-offsets added more sideways poke.
- **Bonus bug found (was live on desktop prod too)**: hero h1 rendered "Oneapp. Yourwhole studio." — inter-word spaces were INSIDE the inline-block `.hero-word` spans, and trailing spaces in inline-blocks get trimmed. Fixed by emitting the space as a text node between spans.
- **Fixes** (all mobile-scoped via sm:/lg:, desktop pixel-checked identical at 1440 before/after): `overflow-x: clip` on the scroll host; mock sidebar hidden <sm + min-w-0 guards on grid children; 3D tilt flattened <lg; reveals are Y-only <lg (landing-scoped, in landing.css); hero CTAs stack full-width 52px; section paddings get mobile tiers (24px gutters); h2 mobile floors 30px (StackReplace 24px + desktop-only <br> + nowrap on "Forty-seven"); pricing strike-note drops to its own line; founder block + footer stack; mock stats go 2+1 (Follow-up card full-width); menu links 44px.
- **Research** (live-CSS pull from Spotify/Linear/Vercel/Superhuman/etc.): mobile hero 36-44px lh 0.95-1.1 max 3 lines, body 16px floor, ONE primary CTA 48-56px, fade-up-only reveals, text-wrap balance — all applied. Report in the SK-51 session transcript.
- Verified: 390 + 360 probes = scrollWidth exactly viewport, zero offenders, full gate green (2942 tests). The red "1 issue" dev-overlay badge in screenshots = pre-existing hydration warning (proved present on untouched baseline; dev-only).
- Flagged, NOT done (desktop-visible, out of mobile scope): landing CTA radii are 10-12px vs buttons.md's 16px standard; section order (FounderNote sits after FAQ; research says credibility-before-pricing converts better).

- **SK-52 follow-on (PR #175, merged)**: auth pages — Clerk card kept (de-card attempt rejected by Gili: "you ruined desktop"), padding slimmed <lg, cl-rootBox width:100% (iOS Safari shrank the fit-content cycle and beached the card left), tighter shell — sign-up fits one phone screen (990→736px). Clerk-cascade gotcha: Tailwind-v4 @layer utilities lose to Clerk's unlayered CSS; scoped !important CSS in globals.css is the fix.

### SK-50 — artist mobile ship-ready audit + polish (MERGED via #173)

Audited ALL artist screens at true 390px against the handoff prototype (refs: /tmp/proto-refs/). Fixes landed on the branch (full gate green, 2942 tests):
- **Music L1/L2 mobile rework** (worst section): L1 2-col cover grid below sm; L2 stacked hero (full title) + Spotify-style track rows below lg (desktop tables untouched at lg+, CSS-only switch).
- **Home density**: LastUpload/NextSession/PaymentRequests no longer truncate at 390; amounts quiet mono; warm empty placeholder; empty helper-line wrap.
- **Funnel polish**: S3 footer overlap FIXED + price in white card; S4 PDF "View" pill; S5 heading; S7 neutral-till-selected prices; S8 plan recap + greyed card row + amber COPY pills; S9 heading/eyebrow/installments hint; S12 dead band gone + green Confirmed pill; S11 green hero + full names.
- **Store (S2)**: hero vignette + readable producer-hue avatar; focal card got a record-sleeve cover band reusing the S3 `coverGradient`/`producerHue` — store and funnel share identity art.
- **Join bio contrast bug** (LIVE IN PROD too): chrome-dark flips `--fg-secondary` light on the cream bento (≈1.1:1) — pinned literal #3D3730/#6B6359 in join-bento.tsx.
- **S6 heartbeat card**: purchase-status card (pending-review + stepper, real artist.purchase.pending) — agent in flight when this was written.

Verification gotchas learned: headless-Chrome CLI clamps windows to ≥500px (layout at 500, PNG cropped to 390 → fake right-chop, hidden overflow) — use Playwright viewport or the CDP script /tmp/sk50-audit/fix-s2/capture.mjs; first capture after a dev-server restart can show stale CSS (recapture); measure scrollWidth BEFORE fullPage screenshots; fixed bottom-nav paints over content in fullPage captures (rows can hide behind it).

TEMP screenshot harness at apps/web/src/app/screenshot-preview/ (untracked) — DELETE before committing. Audit tracker: /tmp/sk50-audit/AUDIT.md.

Open flags for Gili/Raz: music cover palette is cool green/violet vs warm handoff hues (shared w/ producer — product decision); /artist/sessions has no nav entry from the Book tab (IA question); store focal cover for "Gili Studio" hashes to plum (producer identity hue, consistent w/ S3, not the proto's amber).
### Artist purchase flow — LIVE END-TO-END on v3-clean (Gate 1)

All of it merged on the night of 2026-06-09→10:

| PR | What | Status |
|---|---|---|
| #163 | BE-1 backend: `purchase_requests` + tRPC contracts + Gate 1 lifecycle (Raz) | merged (before session) |
| #164 | SK-41 Commit screens (S4 review & agree / S5 request sent) | merged |
| #165 | SK-43 Book (S10 picker restyle / S11 my sessions / S12 detail) | merged |
| #166 | SK-42 Pay (S7 plan / S8 instructions / S9 proof) — still mock until BE-2 | merged |
| #167 | SK-45 S3 product detail + Request to book (funnel entry) | merged |
| #161 | SK-34 boutique store (one storefront per producer) | merged |
| #162 | SK-33 artist home high-fidelity redesign (+ token-form & overflow fixes) | merged |
| #168 | **SK-46 (new): funnel S3/S4/S5 wired to REAL BE-1** + store→funnel links | merged |
| #169 | docs: approval-gates design + purchase-flow design handoff | merged |

**What "wired to real BE-1" means (SK-46):** S3 loads the real product/producer (`artist.store.product`, widened with `deliverables` + `contractUrl`); S4's *Send request* fires `artist.purchase.request` via a server action (price locks server-side; plan locked to the product default — `full` first — until BE-2 brings plan choice); S5 shows the **server-issued booking ref** (`?req=` → `artist.purchase.get`). New read-only `artist.purchase.pending` (flagged for Raz) disables the CTA while a request is in review. Store cards route flat/bundle/hourly products into the funnel; **per-song products stay on the legacy store detail** (funnel has no qty stepper yet — follow-up on SK-46).

**Still mock (intentionally):** Pay slice (BE-2 / SK-38) and sessions list/detail (BE-3 / SK-39) — placeholders live in `pay-data.ts` with `MOCK_*` + swap-point comments. SK-44 Receive (S13/S14 download lock) stays PARKED (BE-4).

**Known gap (commented on SK-36):** nothing calls `acceptAgreement` yet; the "approved → accept → pay" beat (S6) should land with BE-2.

### Open PRs / leftovers
- **#151 (SK-26 inbox home) — SUPERSEDED by #162, should be CLOSED** (session lacked permission to close someone-else's PR; one click for Gili).
- SK-47 producer-mobile PR — see below (in flight when this was written).

### Producer mobile (SK-47) — DONE, all 6 pages
All producer dashboard pages now work at 390px, desktop unchanged (verified by pixel-diff on calendar). The shell already had a mobile bottom bar + player-dock positioning (23c3640); this pass fixed the pages: overview (link strip stacks, urgent rows wrap), clients-projects (ProjectRow collapses to a 2-line card row below md, drag desktop-only), calendar (natural page scroll below lg + horizontally scrollable week grid + 44px targets), music (shared library-screen: tables become horizontal scrollers below lg — artist side verified unaffected), settings (chip rail + stacking + matrix fit), store (cards stack; table is a horizontal scroller w/ readable name column; editor sheet fine) + portfolio (columns stack, drag copy desktop-only). Screenshot evidence in /tmp/sk47-shots/ (sweep + per-page before/after).
Known pre-existing (NOT this branch): Overview "Today's session" 36px time overflows its w-14 column and touches the subtitle — flagged separately.

### Production database — IMPORTANT correction
Prod Neon project is **`skitza` (quiet-sun-92221754)** — Raz applied migration 0021 there. The `skitza-v3` project (raspy-pine) is stale since 2026-05-26. (CLAUDE.md's "fresh skitza-v3 project" note is outdated.) Migration 0021 is applied; nothing pending from tonight's merges (all tonight's PRs were schema-free).

### Deploy state
Everything merged to v3-clean; **NOT promoted to skitza.app** (deliberately left for Gili — verify in Incognito first, then `vercel promote <dpl> && vercel alias set <dpl> skitza.app`, matching `githubCommitSha`).

## Testing/things that bit us tonight (carry forward)
- **Bare `var(--token)` colors render INVISIBLE** — tokens are RGB triplets; always `rgb(var(--token))`. This broke the whole SK-33 home until a screenshot audit caught it.
- Headless Chrome won't open windows narrower than 500px — for 390px truth, embed a scrollWidth probe in the temp preview page.
- Stacked sibling PRs carrying stale copies of the foundation branch conflict after the foundation squash-merges — resolve with `git merge origin/v3-clean` + `--theirs` on foundation-owned files.
- `git pull` aborts silently in `&&` chains when untracked files collide with incoming tracked ones — read the log, don't trust exit-0 notifications.
