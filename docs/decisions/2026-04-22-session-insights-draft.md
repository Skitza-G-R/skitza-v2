# Session insights — 2026-04-22 (draft for Gili's review)

> **Status:** DRAFT. Not canonical until Gili approves. On approval: appended to `360-prd-answers.md` as Round 3, PRD deltas applied, roadmap adjusted.

---

## Context

Today's session produced 11 product decisions + 5 process insights across two areas the PRD covers only shallowly:

1. **Role isolation** (security architecture between Artist ↔ Producer identities)
2. **Artist app as first-class client-facing product** (not producer-lite)

Plus we discovered concrete bugs + a process lesson from the artist-welcome ping-pong that should be codified so we don't repeat it.

---

## Round 3 — Q&A captured 2026-04-22

### Task 16 — Role isolation (3 Qs)

| Q | Topic | User answer | Meaning |
|---|---|---|---|
| Q1 | Complete producer hits `/onboarding` manually | **A** | Bounce to `/dashboard`. Onboarding is a first-run wizard, not an edit surface. |
| Q2 | Close the raw-HTTP-POST loophole in `completeOnboarding`? | **A** | Yes — defense-in-depth. Layouts gate UI; server actions **also** re-check role on every mutation. Security pattern. |
| Q3 | Silent redirect vs toast when bouncing wrong-role users | **A** | Silent. Clean UX over helpful-but-noisy. Wrong-role navigation is rare and invisible by design. |

### Task 17 — Artist UI scope (4 Qs + 3 design-brief follow-ups)

| Q | Topic | User answer | Meaning |
|---|---|---|---|
| Q4 | How deep should the rebuild go? (A minimal / B medium / C full) | **"C with artist features only"** | Full rebuild to match producer desktop **visual** quality, but with artist-only feature set (Home/Music/Book/Store). Not producer-lite. |
| Q5 | Screenshot — what feels "cheap"? | *(screenshot + "it doesn't feel like my app, even if you match it to the producer mobile app")* | The mobile-first aesthetic on desktop isn't enough. Desktop needs a proper sidebar shell. |
| Q6 | Real `/artist/settings` now, or defer? | **B — build now** | *"The app is for the producer for his clients."* The artist side IS the client-facing product producers pay for. It has to feel first-class. |
| Q7 | Sign-out destination | **A — `/` (marketing)** | With caveat: *"eventually going to be an app, so it would be a welcome screen to sign in only."* Short-term → `/`. Long-term (native mobile) → dedicated welcome/sign-in screen. |
| §7.Q1 | Desktop sidebar persistent or collapsible? | **Like producer (collapsible)** | Use same `[`-shortcut + localStorage pattern. Consistency across both apps. |
| §7.Q2 | Artist notification bell? | **Yes** | Phase 2 scope. New kinds needed: new mix uploaded, session confirmed, payment received, producer messaged. |
| §7.Q3 | Mobile settings placement | **Nested in UserButton menu** | Not a 5th bottom-nav tab (would cramp 360px mobile). Settings reachable via avatar. |

### Implicit Q&A during ping-pong

| Topic | Resolution |
|---|---|
| Dual-role users (producer-who-is-artist-of-another-producer) | **Allowed.** No objection to dual-role. |
| Producer signing into own `/join/<slug>` link | **Route to /dashboard**, not client_contacts as self. Bounce check in the action. |
| Clerk `unsafeMetadata` as signup-origin channel | **Accepted architectural pattern.** Carries `signupOrigin: "join"` + `producerSlug` from sign-up form → webhook → any server-side recovery logic. |
| Welcome splash ("You're now connected to X") | **Killed.** "I don't need this page it's worthless, when I click the button it should take me straight to the app." |

---

## What's NEW (not in PRD v2 or roadmap)

### D1 — Artist app is first-class client-facing product
**Source:** Q6 answer.
**Delta:** PRD §2.2 (Artist persona) frames the artist as "the client" but doesn't set a design bar. Today's decision raises it: **the artist app is what producers present to paying clients as their studio**. Its quality IS the producer's brand. Not producer-lite — genuinely premium.
**Implication:** every artist-side decision is evaluated through "does this make the producer look good to their client?"

### D2 — Hard role wall, silent redirects
**Source:** Q3 + Task 16 design.
**Delta:** Not in PRD. Today's decision: any authed user whose role resolves to "artist" is **unconditionally** redirected off producer routes (including /onboarding, /dashboard, /dashboard/**, /onboarding). Silent redirects — no toasts. Defense-in-depth: layouts gate, actions double-check.
**Implication:** all future producer routes need this guard. Pattern codified via `resolveUserRole` helper + per-route `decide-redirect` policies.

### D3 — Welcome splash killed (PRD §6.3 is outdated)
**Source:** User explicitly rejected the splash.
**Delta:** PRD §6.3 step 1 currently reads *"Welcome splash (1 screen): 'You're in — here's [Producer]'s studio.'"* This is contradicted by today's decision. **Delete.**
**Replacement:** Signup → direct to `/artist`. Server-side insert of client_contacts happens transparently during the redirect, before `/artist` renders. No UI between Clerk's post-signup and the artist home.
**Open hole:** current implementation of this transparent insert is broken in production (the artist-welcome ping-pong). Post-Sentry triage.

### D4 — Artist desktop = producer visual parity + artist features only
**Source:** Q4 answer.
**Delta:** PRD §5 says "Home/Music/Book/Store" for the artist app but is viewport-agnostic. §17.3 covers producer mobile but not artist desktop.
**Addition:** Artist app is **responsive dual-shell**:
- **Mobile** (<md): existing bottom-nav PWA style (StudioSwitcher + UserButton in top header, 4-tab bottom nav, persistent mini-player).
- **Desktop** (≥md): left sidebar matching producer's visual language (collapsible rail with `[` shortcut, Studio Switcher at top, 4-item nav, theme + notification bell + language + UserButton in footer). Bottom nav hidden.
- Settings reached via UserButton dropdown on both viewports.

### D5 — UserButton as account surface + navigation hub
**Source:** Task 17 Phase 1 + design-brief §7.Q3.
**Delta:** Not explicit in PRD. Today's decision: `<UserButton />` (Clerk component) is the canonical account-management surface across both artist AND producer apps. It carries:
- Default Clerk menu items (Manage account, Sign out)
- Custom items via `UserButton.Link`: "Settings" (→ `/artist/settings`), "Producer dashboard" (→ `/dashboard`, conditionally shown for dual-role users)
- Theming via `appearance` prop matching the producer sidebar's avatar sizing

### D6 — Sign-out destination evolves with platform
**Source:** Q7 answer.
**Delta:** Short term: `/` (marketing landing) — configured via Clerk `afterSignOutUrl` in root `ClerkProvider`. Long term: when the native mobile app ships (Tauri Mobile per PRD §17.2), sign-out lands on a dedicated welcome/sign-in screen — not the marketing page (no "re-shop for us" on a native app). This is a **platform-dependent** configuration to revisit at Phase 3/4.

### D7 — Clerk unsafeMetadata as signup-origin channel
**Source:** Task 15 architecture (shipped) + Task 16 enforcement (shipped) + today's self-heal attempts.
**Delta:** Not in PRD — but now load-bearing. The flow `/sign-up/join/<slug>` sets `unsafeMetadata={ signupOrigin:"join", producerSlug:<slug> }` on the Clerk user. That metadata survives on the user forever, readable via `currentUser()` server-side. It's used as:
1. **Webhook branching signal** — `user.created` webhook reads it to route into `client_contacts` vs `producers` insert.
2. **Recovery signal** — if any role-check logic finds a user as orphan but they carry this metadata, we can reconstruct their intended flow.
**Security note:** "unsafe" in Clerk's naming = client-settable. We always re-validate (the slug is resolved against the DB; malformed metadata falls through to the default branch). Never trust it for authorization.

### D8 — Artist notification kinds (for Phase 2 bell + Sentry-triage)
**Source:** §7.Q2 answer.
**Delta:** PRD §5 mentions "cross-studio notification bell" but doesn't enumerate kinds. PRD §14 enumerates EMAIL kinds but not in-app notifications. Proposed artist-side notification kinds:
- `new_mix_uploaded` — producer shared a new version on a project you're on
- `session_confirmed` — your booking got confirmed
- `payment_received` — Skitza processed a payment from you
- `producer_replied` — producer replied to a track comment you made
Phase 2 needs: `notification_kinds` enum extension + new tRPC procedure on `artistProcedure` + wire the bell.

### D9 — No 5th mobile tab
**Source:** §7.Q3 answer.
**Delta:** PRD §5 lists 4 tabs. Settings-as-tab was considered and rejected — would cramp 360px viewports.
**Canonical rule:** Artist bottom nav stays at exactly **4 tabs** (Home/Music/Book/Store). New surfaces reach via UserButton menu or in-tab navigation.

### D10 — Action-level role hardening (server actions re-verify)
**Source:** Q2 answer.
**Delta:** Security pattern not in PRD. **Every server action that mutates producer-scoped data MUST `await fetchUserRole()` and explicitly reject if `role.kind === "artist"`** — even though layouts also gate the UI. Defense-in-depth. Precedent: `completeOnboarding` action in `/onboarding/actions.ts` (shipped in Task 16).

### D11 — Observability is a hard prerequisite for auth/webhook work
**Source:** Today's ping-pong.
**Delta:** Not in PRD. Today's lesson made concrete: we burned several hours on artist-welcome bugs because we were flying blind. **Henceforth: no further Clerk/webhook/auth-flow changes land until Sentry is wired and we can read production logs.** Task 14 (observability) is elevated from "Phase 1 routine" to "hard blocker on any future auth work."

---

## Process insights (not product — codify in CLAUDE.md)

### P1 — Quarantine list discipline
When multiple fix attempts fail on the same code path, add those files to a quarantine list in the session recap and the active plan. Don't touch again until:
1. Observability is live to diagnose, or
2. The surrounding bug is reproducible locally, or
3. A design review rethinks the approach.

Today's quarantine list:
- `/sign-in`, `/sign-up`, `/sign-up/join`
- `(artist)/artist/layout.tsx`
- `(artist-welcome)/**`
- `api/webhooks/clerk/**`

### P2 — Stop ping-pong at attempt 3
If three consecutive fixes to the same user-reported bug don't resolve it, stop patching and:
1. Pull production logs (Vercel runtime, Sentry, anything available).
2. Reproduce locally if possible.
3. If neither helps: quarantine, surface the bug in the roadmap, move to other work.
Heuristic: **the 4th patch is never right.** Each patch that ships without diagnosis adds new failure modes.

### P3 — `console.error` over `console.log` for diagnostics
Vercel's default log filter reliably surfaces `error` level; `info` sometimes gets dropped. For any diagnostic instrumentation you want to *actually see*, use `console.error` (even for non-error conditions). Remove once Sentry lands.

### P4 — Neon HTTP cross-request eventual consistency
Confirmed during the ping-pong: within a single Node function invocation, reads see writes. **Across** HTTP requests (e.g. action commits on request 1, layout reads on request 2), reads can lag the write by hundreds of ms. Any "insert + redirect + verify" flow must do the verify in the SAME request, not on the next one. Avoid redirect-based handshakes for recently-written data.

### P5 — Server-side `redirect()` throws `NEXT_REDIRECT`
Calling `redirect()` in a Server Component / server action throws a special error that Next.js catches upstream to perform the redirect. Don't wrap `redirect()` in try/catch — it'll swallow the redirect. Only catch *other* errors.

---

## Proposed PRD deltas (for Gili's review before applying)

| PRD section | Change |
|---|---|
| **§2.2** (Artist persona) | Add sentence: *"The artist app IS the client-facing product producers pay for; its design bar is first-class client SaaS, not producer-lite."* |
| **§5** (4 Artist app tabs) | Expand with **§5.1 Responsive shell** (mobile bottom-nav vs desktop sidebar, per D4). Add UserButton as account surface (D5). Enumerate artist notification kinds (D8). |
| **§5 canonical rule** | Lock "4 mobile tabs only" (D9) as explicit rule. |
| **§6.3** (Sign-up flow step 1) | Delete the "Welcome splash" step (D3). Replace with: "Signup → Clerk redirects via fallbackRedirectUrl → server-side client_contacts insert → `/artist` home." |
| **§6.3** (new) | Add "§6.3b Role isolation" subsection codifying D2 (silent redirects + server-action hardening). |
| **new §16.1a or §22.x** | Add "Observability is a prerequisite for auth/webhook work" (D11). |
| **new §17.4** | "Sign-out destination" — `/` for web (D6a), welcome screen for native (D6b). |
| **new §23.x** | "`unsafeMetadata` as signup-origin channel" — architectural pattern (D7). |
| **§14** | Add in-app notification kinds alongside email kinds (D8). Distinguish email vs in-app. |

## Proposed roadmap deltas

| Line | Change |
|---|---|
| **Phase 1 S1.x** — Sentry install | Elevate from "nice to have observability" to "hard blocker for re-attempting Task 17 Phase 2+3 and all artist-welcome bugs." |
| **Phase 2 Task 17 Phase 2+3** | Add status: "⏸ blocked on Sentry. Branch `feat/task-17-artist-desktop-sidebar` preserved on GitHub for salvage." |
| **Phase 2 (new line)** | "Artist-welcome observability triage — post-Sentry, pull 48h of logs, identify the real failure modes behind today's ping-pong, fix with data not guesses." |
| **Phase 3 (new line)** | "Native-mobile-welcome screen" — D6b — blocked on Tauri Mobile shipping. |

## Proposed CLAUDE.md additions

| Section | Add |
|---|---|
| Mistake log | 2026-04-22 — artist-welcome ping-pong: 8 hours of fix attempts without observability; ended in a redirect loop; reverted. Rule: no further Clerk/webhook changes until Sentry. |
| Conventions | "Quarantine list" discipline (P1). |
| Conventions | "Stop ping-pong at attempt 3" rule (P2). |
| Conventions | `console.error` for diagnostics (P3). |
| Conventions | Neon HTTP cross-request consistency gotcha (P4). |
| Conventions | `redirect()` throws NEXT_REDIRECT — don't wrap (P5). |

---

## How Gili approves

Say which deltas to apply:
- **"apply all"** → all PRD + roadmap + CLAUDE.md deltas get committed to main.
- **"apply D1, D3, D9"** (pick any subset) → only those get applied.
- **"push back on D3"** (or any) → I explain/revise.
- **"leave it — just keep the draft"** → this file stays as a record, nothing else changes.

---

## Metadata

- **Source session:** 2026-04-22 full day (Tasks 15, 16, 17 attempts + artist-welcome ping-pong)
- **Decisions extracted:** 11 product (D1-D11), 5 process (P1-P5)
- **Questions asked of Gili today:** 10 (3 Task 16, 4 Task 17 initial, 3 Task 17 design-brief)
- **Explicit rejections:** welcome splash (PRD §6.3 step 1)
- **Abandoned work:** Task 17 Phases 2+3, multiple artist-welcome fixes, `/sign-in` `forceRedirectUrl` removal (was correct but bundled)
