# Producer Onboarding Wizard — Architecture (2026-04-25 rebuild)

> Plan owner: BMAD Architect phase. Companion to PRD §4.5 (committed at `889b6a7`).
> Story files: `docs/plans/stories/onboarding-rebuild-NN-*.md`.
> Branch: `feat/onboarding-rebuild`.

## 1. Scope & purpose

Replace today's single-screen `/onboarding` page (display name + slug + currency + timezone) with a 4-step full-screen stepper that:

1. Captures display name (auto-generates slug + invisible currency/timezone)
2. Reuses `package-form.tsx` to create the producer's first service
3. Reuses `availability-section.tsx` (+ 5 child editors) to bootstrap weekly hours, blackouts, defaults, GCal stub
4. Adds NEW components for portfolio: external-links editor (Spotify / YouTube / Instagram) + track upload (reusing `audio-uploader.tsx` + R2 multipart pipeline)

**Out of scope here**: real Google Calendar OAuth (PRD §18.1), Stripe Connect onboarding (deferred to Setup → Connections), avatar/brand customization, second service flow.

## 2. Prerequisites already met

- `producers` table has all needed columns ([`schema.ts:30`](../../packages/db/src/schema.ts#L30))
- `products` table for services ([`schema.ts:166`](../../packages/db/src/schema.ts#L166))
- `availability_blocks` ([`schema.ts:238`](../../packages/db/src/schema.ts#L238)), `portfolio_tracks` ([`schema.ts:94`](../../packages/db/src/schema.ts#L94)), `producer_external_links` ([`schema.ts:777`](../../packages/db/src/schema.ts#L777)) all exist
- tRPC routers exist: `producer`, `booking` (services), `portfolio`, `producer-external-links`, `audio` (multipart)
- Role-resolution rule ([`server/auth/role.ts`](../../apps/web/src/server/auth/role.ts)) already gates `/onboarding` correctly — no changes
- Existing onboarding redirect policy ([`(onboarding)/onboarding/decide-redirect.ts`](../../apps/web/src/app/(onboarding)/onboarding/decide-redirect.ts)) tested — no changes
- `audio-uploader.tsx` exists with multipart upload hook

## 3. No schema migrations required

This is intentional. Every column the wizard writes already exists. Verified by grep + manual read:

| Wizard writes | Target table.column | Required? | Default if not provided |
|---|---|---|---|
| Step 1 displayName | `producers.display_name` | ✅ | – |
| Step 1 (server-derived) slug | `producers.slug` | ✅ | – |
| Step 1 (server-derived) defaultCurrency | `producers.default_currency` | optional | `'USD'` |
| Step 1 (server-derived) timezone | `producers.timezone` | optional | `'UTC'` |
| Step 2 service fields | `products.*` (10+ cols) | mostly defaulted | see PRD §4.5 |
| Step 3 windows | `availability_blocks.*` | – | – |
| Step 3 settings | `producers.{default_session_min, auto_confirm_bookings, cancellation_policy_hours}` | optional | existing defaults |
| Step 4 link | `producer_external_links.{platform, url}` | ✅ | – |
| Step 4 track | `portfolio_tracks.*` (via existing audio.completeMultipart) | – | – |

**Result**: zero migrations, zero `_journal.json` work. Bypasses the broken-journal mistake from CLAUDE.md log 2026-04-20.

## 4. Server contracts

### 4.1 Pure helpers (Story 01 — TDD-first)

New file `apps/web/src/lib/onboarding/derive.ts` (pure, no I/O):

```ts
// Derive a slug from displayName + 4-char random hash. Guaranteed to
// differ from emailToSlug(email) for any non-empty displayName, so it
// breaks the isAutoSlug rule and marks the producer "complete".
export function slugFromDisplayName(displayName: string, randomHex4: string): string

// Map an ISO 3166-1 alpha-2 country code → supported currency.
// US/CA/AU/NZ → USD; UK/GB → GBP; IL → ILS; EU members → EUR; else USD.
export function currencyFromCountry(country: string | null | undefined): "USD" | "EUR" | "GBP" | "ILS"
```

Story 01's tests pin behavior: trims whitespace, lowercases, collapses non-allowed chars to `-`, slices ≤ 48 chars, appends 4-char hash separator `-`, never returns the email-derived form. The country map is a closed table — every supported country is asserted, plus a few unsupported (CN, JP, BR) that should fall back to USD.

### 4.2 Server action: `completeStudio` (Story 03)

Replaces the existing `completeOnboarding` action ([`(onboarding)/onboarding/actions.ts`](../../apps/web/src/app/(onboarding)/onboarding/actions.ts)). Signature:

```ts
"use server";
async function completeStudio(input: {
  displayName: string;          // required, 1..80
  timezone: string;              // hidden field from Intl
}): Promise<{ ok: true } | { ok: false; error: string }>
```

Implementation:
1. Auth via Clerk + role check (preserve existing artist-rejection guard from `actions.ts:29`)
2. Read `x-vercel-ip-country` from `headers()` (Next.js App Router) — null in dev/local
3. `currency = currencyFromCountry(country)`
4. `slug = slugFromDisplayName(displayName, crypto.randomBytes(2).toString("hex"))`
5. UPSERT producer by clerkUserId with displayName / slug / currency / timezone
6. On unique-slug conflict: regenerate hash, retry up to 3 times. If still fails, throw friendly error (extremely unlikely — 65 536 possible suffixes per name).
7. Fire telemetry: `producer.onboarding.step_completed` with `{ step: "studio" }`

### 4.3 Service create (Story 04)

**Reuses existing `createPackage` server action** at [`(app)/dashboard/booking/actions.ts`](../../apps/web/src/app/(app)/dashboard/booking/actions.ts) — no new API surface. The wizard's Step 2 just renders `<NewPackageForm onClose={advanceToStep3} />` from [`package-form.tsx`](../../apps/web/src/app/(app)/dashboard/booking/package-form.tsx). The `onClose` prop is misnamed historically — it's the success callback. Producer-procedure auth is already enforced inside the action.

After successful create, fire telemetry: `producer.onboarding.step_completed` with `{ step: "service" }`.

### 4.4 Availability writes (Story 05)

**Reuses existing tRPC mutations** that the 5 child editors already call. The wizard renders `<AvailabilitySection blocks={[]} blackouts={[]} settings={producerDefaults} />` and lets each child island handle its own writes via existing tRPC. No new server code.

After producer leaves Step 3 (Continue OR Skip), fire telemetry: `producer.onboarding.step_completed` or `step_skipped` with `{ step: "availability" }`.

### 4.5 Portfolio writes (Stories 06 + 07)

**External links** — reuse existing `producerExternalLinks.create` mutation in [`producer-external-links.ts`](../../apps/web/src/server/trpc/routers/producer-external-links.ts). The wizard renders 3 inputs; on Continue, a server action loops over filled inputs and calls the mutation per row.

**Track upload** — uses existing flow: `portfolio.createPlaceholder` (creates empty `portfolio_tracks` row + a `track_versions` row, returns `trackVersionId`) → `<AudioUploader trackVersionId={...} onComplete={...} />` → `audio.completeMultipart` finalizes the row. Verify the placeholder mutation exists; if not, Story 07 adds it as a thin wrapper around existing `portfolio.createTrack`.

After Continue OR Skip, fire telemetry: `step_completed` / `step_skipped` with `{ step: "portfolio" }`.

## 5. Component tree

```
apps/web/src/app/(onboarding)/onboarding/
  layout.tsx                          # UNCHANGED — keeps role gate + i18n provider
  page.tsx                            # CHANGED — redirects to /onboarding/studio (default step)
  decide-redirect.ts                  # UNCHANGED
  actions.ts                          # CHANGED — completeOnboarding → completeStudio (Story 03)
  studio/page.tsx                     # NEW — Step 1
  service/page.tsx                    # NEW — Step 2
  availability/page.tsx               # NEW — Step 3
  portfolio/page.tsx                  # NEW — Step 4
  shell.tsx                           # NEW — shared layout (gradient, progress bar, action bar)
  use-step-nav.ts                     # NEW — tiny hook for step routing + Skip/Continue

apps/web/src/components/onboarding/
  step-shell.tsx                      # NEW — header (eyebrow + display-font H1) + content slot
  progress-bar.tsx                    # NEW — 4-segment slim bar, active glows brand-primary
  action-bar.tsx                      # NEW — sticky bottom: Back / Continue / Skip ghost
  external-links-editor.tsx           # NEW (Story 06) — 3 platform inputs
  portfolio-uploader-card.tsx         # NEW (Story 07) — wraps AudioUploader + creates placeholder

apps/web/src/lib/onboarding/
  derive.ts                           # NEW (Story 01) — slugFromDisplayName, currencyFromCountry
  derive.test.ts                      # NEW (Story 01) — pure unit tests
```

**Pure-reuse imports** (zero changes to these files):
- `~/app/(app)/dashboard/booking/package-form` → `NewPackageForm` (Step 2)
- `~/components/dashboard/setup/availability-section` → `AvailabilitySection` (Step 3)
- `~/components/audio/audio-uploader` → `AudioUploader` (Step 4 inner)
- `~/app/(app)/dashboard/booking/gcal-sync-badge` → `GCalSyncBadge` (already inside availability-section, free reuse)

## 6. Layout & motion specs

### Shell (`shell.tsx` — wraps every step page)

```
┌──────────────────────────────────────────────────────────┐
│ ▓▓▓▓░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  ← progress    │  ← .reveal-up on mount
│                                                          │
│   ONBOARDING · STEP 1 OF 4              ← font-mono      │
│   Name your studio.                      ← font-display  │
│   ───────────────                                        │
│                                                          │
│   [step content here — varies per step]                  │
│                                                          │
│                                                          │
│   ───────────────────────────────────────                │
│   ← Back                  Skip for now    Continue →     │  ← sticky bottom
└──────────────────────────────────────────────────────────┘
   ambient brand-glow blob (top center, --brand-primary at 0.08 alpha)
```

- Background: `bg-[rgb(var(--bg-base))]`. Ambient blob: same as current `page.tsx:55-58`.
- Progress bar: 4 segments separated by 2px gaps. Active segment fills with brand-primary, completed segments with brand-primary at 60% alpha, pending with `--border-subtle`.
- Step header: identical typography to current onboarding (font-mono eyebrow + font-display H1 with `opsz` 96).
- Action bar: sticky bottom on mobile (avoids keyboard fight via safe-area-inset-bottom + `sk-safe-bottom` class). Inline-flex with Back chip on left (hidden on Step 1), Skip ghost link + Continue primary on right.

### Step transitions

- Forward: outgoing step's content fades to opacity 0 over 120 ms, simultaneously incoming content fades from 0 → 1 over 200 ms with 4 px upward translate. Use `.reveal-up` keyframe (already defined in `globals.css`).
- Back: same shape, mirrored.
- Reduced motion: instant swap (≤ 50 ms opacity), no translate. Existing `prefers-reduced-motion` gate in `globals.css` covers `.reveal-up`.

### Per-step heights

- Step 1: ~480 px content height (one input + helper text)
- Step 2: ~860 px (NewPackageForm has 10+ fields stacked) — page scrolls vertically below shell
- Step 3: ~1100 px (5 child editors stacked vertically) — scrolls
- Step 4: ~520 px (3 link inputs + 1 dropzone)

The shell does NOT center content vertically when content > viewport. Top-aligned with 24 px header padding so the progress bar always anchors the same way.

## 7. Test strategy

Per CLAUDE.md mistake log 2026-04-22: applying TDD to defensive code branches, not just to pure helpers.

| Layer | Test type | Story |
|---|---|---|
| `derive.ts` (slug + currency) | Pure unit (vitest, no mocks) | 01 |
| `completeStudio` server action | Mocked DB + mocked headers, asserts UPSERT shape + slug-conflict retry | 03 |
| Step shell (progress bar, action bar, motion gate) | RTL render test, asserts ARIA + reduced-motion class behavior | 02 |
| External-links server action | Mocked DB, asserts auth scoping (`producerId` from ctx, never input) | 06 |
| Portfolio placeholder mutation (if added) | Mocked DB, asserts producerId scoping + position default | 07 |
| Drop-off behavior | Existing `decide-redirect.test.ts` already covers — extend with one case for "post-Step-1 visit redirects to /dashboard" | 08 |
| Per-step skip routing | Pure unit on a `nextStepFor(currentStep, action)` function | 08 |
| Server-side currency resolution end-to-end | Integration test in `actions.test.ts` mocking `headers().get('x-vercel-ip-country')` | 03 |

**Auth-scoping assertions** (per CLAUDE.md tRPC conventions): every server action / mutation that writes scoped data MUST be tested via the `findPredicate` helper to verify the WHERE / values clause carries `producerId = ctx.producerId`. No exceptions — same pattern as `artist-home.test.ts`.

## 8. Edge cases

| Case | Behavior |
|---|---|
| Slug collision after 3 retries | Throw `Error("could not allocate slug — please try a slightly different studio name")` — extremely unlikely (~10⁻¹² for any single name) but worth handling |
| `x-vercel-ip-country` missing (local dev) | `currency = "USD"` fallback. No error. |
| `Intl.DateTimeFormat().resolvedOptions().timeZone` unavailable (rare browsers) | `timezone = "UTC"` fallback (matches existing behavior at `page.tsx:13-17`) |
| Producer-complete user navigates directly to `/onboarding/service` | Layout gate redirects to `/dashboard` (existing rule applies — completeness fires after Step 1, so Steps 2-4 are post-completion routes; the gate redirects them out) |
| Artist navigates directly to any onboarding step | Hard redirect to `/artist` (existing Task-16 guard) |
| User refreshes mid-Step-3 | Each step is its own URL — refresh re-renders the same step. Form state inside `AvailabilitySection` is server-backed (each child has its own optimistic-update behavior + persisted writes), so refresh doesn't lose data. |
| User clicks Continue with empty Service Name | Existing `NewPackageForm` validation surfaces inline error — no advance. |
| User clicks Skip on Step 4 with one filled link + no track | Filled link saves; user lands on `/dashboard`. |
| User uploads track but Continue before audio.completeMultipart fires | Track upload returns a Promise; Continue button is disabled while upload in progress (existing `useMultipartUpload` exposes `state.uploading`) |

## 9. Story breakdown (full list — files in `docs/plans/stories/`)

| # | File | Scope | Approx. effort | Dispatchable in parallel? |
|---|---|---|---|---|
| 01 | `onboarding-rebuild-01-derive-helpers.md` | Pure helpers (slug, currency) + tests. NO UI. | 30 min | – (foundation) |
| 02 | `onboarding-rebuild-02-shell-and-progress.md` | Shell layout + progress bar + action bar + motion. No data, no steps wired. | 1 h | After 01 |
| 03 | `onboarding-rebuild-03-step1-studio.md` | Step 1 page + completeStudio server action + slug-retry logic. Tests pin role guard, slug-from-displayName, currency-from-headers. | 1.5 h | After 01, 02 |
| 04 | `onboarding-rebuild-04-step2-service.md` | Step 2 page renders `<NewPackageForm>` in create mode. Onboarding-specific success handler advances to Step 3. | 45 min | After 02, 03 |
| 05 | `onboarding-rebuild-05-step3-availability.md` | Step 3 page renders `<AvailabilitySection>` with empty arrays + producer defaults. | 45 min | After 02, 03 |
| 06 | `onboarding-rebuild-06-external-links-editor.md` | NEW component: 3 platform inputs + bulk-create server action. | 1.5 h | After 02 |
| 07 | `onboarding-rebuild-07-portfolio-uploader.md` | NEW component: wraps `AudioUploader`, manages placeholder lifecycle. | 1.5 h | After 02, 06 |
| 08 | `onboarding-rebuild-08-step4-portfolio-page.md` | Step 4 page composes 06 + 07. Skip-or-continue routes to `/dashboard`. | 45 min | After 06, 07 |
| 09 | `onboarding-rebuild-09-skip-and-routing.md` | Per-step skip behavior, decide-redirect extension, drop-off test cases. | 45 min | After 03-08 |
| 10 | `onboarding-rebuild-10-qa-polish.md` | skitza-ux-critic pass, mobile 360px audit, motion-reduced check, end-to-end smoke. | 1 h | Last |

**Total**: ~10 hours of focused dev + 1 h QA polish = 3-5 calendar days at solo-founder cadence with subagent dispatch.

## 10. Rollout & verification

1. Each story dispatched in fresh `skitza-tdd-implementer` subagent (CLAUDE.md anti-pattern: one subagent doing all stories → context rot)
2. After each story: `/skitza-verify` (typecheck + lint + test + build)
3. After Story 03 lands: smoke-test the existing `completeOnboarding` redirect path is replaced (no orphan code)
4. After Story 09: full mobile audit at 360 px viewport (CLAUDE.md UI rule)
5. After Story 10: open PR with full test plan, dispatch `skitza-ux-critic` for the polish review against Samply / Spotify-for-Artists benchmarks
6. Telemetry events to fire (defer dashboard wiring): `producer.onboarding.step_completed` + `producer.onboarding.step_skipped`

## 11. Things explicitly NOT in scope of this rebuild

- Real Google Calendar OAuth (PRD §18.1) — Step 3 reuses the "coming soon" stub
- Stripe Connect onboarding — moved to Setup → Connections per the v2 PRD delta
- Avatar / brand color customization
- Bio / description copy capture
- Plan selection (Starter / Pro tiering not exposed at signup)
- Setup-nudge banner overhaul on Today (existing copy still applies; PRD §4.1)
- Telemetry pipeline / dashboard for the new events (we fire them; reading is later)
- A/B test scaffolding for variant onboarding flows

## 12. References

- PRD §4.5 (this branch, commit `889b6a7`)
- Schema: `packages/db/src/schema.ts:30, 94, 166, 238, 777`
- Existing onboarding: `apps/web/src/app/(onboarding)/onboarding/`
- Auth gate: `apps/web/src/server/auth/role.ts`
- Reused form: `apps/web/src/app/(app)/dashboard/booking/package-form.tsx`
- Reused availability: `apps/web/src/components/dashboard/setup/availability-section.tsx`
- Reused uploader: `apps/web/src/components/audio/audio-uploader.tsx`
- CLAUDE.md mistake-log entries that constrain this work: 2026-04-17 (verify enums against schema), 2026-04-19 (ARIA IDs after rename), 2026-04-22 (TDD for defensive code branches), 2026-04-23 (R2 CORS pre-req)
