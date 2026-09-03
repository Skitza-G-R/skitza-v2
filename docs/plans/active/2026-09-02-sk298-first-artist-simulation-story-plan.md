# SK-298 story v2 — implementation plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the 11-frame "Watch your first artist" simulation with the approved 8-frame story (Store → approve → agreement → pay → verify → Music → Sessions → dashboard → closing) using live screens in their *done* state, with zero database writes.

**Architecture:** `simulation-model.ts` stays the only place story data is derived (product → song, booking, session, dashboard, request snapshot, frames). `first-artist-simulation.tsx` composes live screens; artist frames are inert storyboards with a one-beat "auto-act" flip, producer frames use preview seams. Two live components gain an additive preview prop.

**Tech Stack:** Next.js 15 App Router, React 19, Radix Dialog, Vitest + Testing Library (jsdom), Tailwind v4 tokens as `rgb(var(--token))`.

Design: `docs/plans/active/2026-09-02-sk298-first-artist-simulation-story-design.md`.
Worktree: `.worktrees/sk-298`, branch `giasraf/sk-298-onboarding-watch-your-first-artist-render-only-simulation`.
All paths below are relative to `apps/web/src` unless they start with `apps/` or `docs/`.

Verification for every task: from `apps/web`, `pnpm vitest run <test file>`; before the PR, `pnpm typecheck && pnpm lint && pnpm test` in `apps/web` and `pnpm typecheck` in `packages/db`.

---

### Task 1: Model — new frame list, timezone, story data

**Files:**
- Modify: `components/onboarding/first-artist-simulation/simulation-model.ts`
- Test: `components/onboarding/first-artist-simulation/__tests__/simulation-model.test.ts`

**Step 1: Failing tests** (add to the model test; keep existing plan/tax tests)

```ts
it("tells the 8-frame story and numbers the frames", () => {
  const model = buildSimulation(PREVIEW_SIMULATION_INPUT, NOW);
  expect(model.frames.map((f) => f.id)).toEqual([
    "store", "approve", "agreement", "pay", "verify", "music", "sessions", "dashboard", "closing",
  ]);
  expect(model.frames.map((f) => f.step)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, null]);
  expect(model.frames.map((f) => f.side)).toEqual([
    "artist", "producer", "artist", "artist", "producer", "artist", "artist", "producer", "closing",
  ]);
  expect(model.frames.filter((f) => f.interactive).map((f) => f.id)).toEqual(["approve", "verify"]);
});

it("skips the sessions frame when the product includes no studio time", () => {
  const model = buildSimulation(
    { ...PREVIEW_SIMULATION_INPUT, product: { ...PREVIEW_SIMULATION_INPUT.product, durationMin: 0, sessionCount: 0 } },
    NOW,
  );
  expect(model.includesStudioTime).toBe(false);
  expect(model.frames.map((f) => f.id)).not.toContain("sessions");
  expect(model.frames.filter((f) => f.step !== null)).toHaveLength(7);
  expect(model.dashboard.todaySession).toBeNull();
});

it("builds the song with v2 ready for approval, her note at 0:42, and the approved twin", () => {
  const model = buildSimulation(PREVIEW_SIMULATION_INPUT, NOW);
  const { data, approved } = model.song;
  expect(data.track.title).toBe("Blue Hour");
  expect(data.selectedVersionId).toBe(SIMULATION_IDS.versionTwo);
  const v2 = data.versions.find((v) => v.id === SIMULATION_IDS.versionTwo)!;
  expect(v2.producerMarkedFinalAtIso).not.toBeNull();
  expect(v2.artistApprovedAtIso).toBeNull();
  expect(v2.peaks).toHaveLength(200);
  expect(v2.delivery.permission).toBe("payment_required");
  expect(data.comments.map((c) => [c.versionId, c.timeMs, c.fromProducer])).toEqual([
    [SIMULATION_IDS.versionTwo, 42_000, false],
    [SIMULATION_IDS.versionTwo, 42_000, true],
  ]);
  expect(approved.track.artistApprovalLocked).toBe(true);
  expect(approved.versions.find((v) => v.id === SIMULATION_IDS.versionTwo)!.artistApprovedAtIso).toBe(NOW.toISOString());
  // Fully paid products unlock downloads on the song page.
  const paidInFull = buildSimulation(
    { ...PREVIEW_SIMULATION_INPUT, product: { ...PREVIEW_SIMULATION_INPUT.product, paymentPlans: [{ kind: "full" }] } },
    NOW,
  );
  expect(paidInFull.song.data.versions[0]!.delivery.permission).toBe("purchase_fully_paid");
});

it("books the next working day at 14:00 in the producer's zone", () => {
  // NOW = Wed 2 Sep 2026 20:00 UTC → Thu 3 Sep 14:00 Asia/Jerusalem = 11:00 UTC
  const model = buildSimulation(PREVIEW_SIMULATION_INPUT, NOW);
  expect(model.session.item.startsAtISO).toBe("2026-09-03T11:00:00.000Z");
  expect(model.session.item.status).toBe("confirmed");
  expect(model.session.item.durationMin).toBe(60);
  expect(model.session.allowance.sessionsRemaining).toBe(2);
  expect(model.booking.availability.days).toHaveLength(4);
  expect(model.booking.availability.days[0]!.date).toBe("2026-09-03");
  expect(model.booking.activePackages[0]!.sessionsRemaining).toBe(3);
  // Friday rolls to Sunday.
  const friday = buildSimulation(PREVIEW_SIMULATION_INPUT, new Date("2026-09-03T20:00:00.000Z"));
  expect(friday.session.item.startsAtISO).toBe("2026-09-06T11:00:00.000Z");
});

it("populates the dashboard from the story", () => {
  const model = buildSimulation(PREVIEW_SIMULATION_INPUT, NOW);
  expect(model.dashboard.pulseStats).toEqual({
    commercialAvailable: true, thisMonthCents: 90_000, outstandingCents: 90_000, currency: "ILS", activeProjects: 1,
  });
  expect(model.dashboard.todaySession?.occurredAt.toISOString()).toBe("2026-09-03T11:00:00.000Z");
  expect(model.dashboard.recentUploads[0]?.versionLabel).toBe("v2");
  expect(model.dashboard.now.getTime()).toBeLessThan(model.dashboard.todaySession!.occurredAt.getTime());
});

it("describes the request as a proposal with the product's real terms", () => {
  const model = buildSimulation(PREVIEW_SIMULATION_INPUT, NOW);
  expect(model.request.snapshot.selectedPaymentPlan).toBeNull();
  expect(model.request.snapshot.offeredPaymentPlans).toEqual([{ kind: "split_50_50" }, { kind: "full" }]);
  expect(model.request.snapshot.totalCents).toBe(180_000);
  expect(model.request.snapshot.deliverables).toEqual(["Production", "Mix", "Master"]);
  expect(model.request.totalLabel).toBe("₪1,800");
});
```
`NOW = new Date("2026-09-02T20:00:00.000Z")` at the top of the test file; `PREVIEW_SIMULATION_INPUT` gains `timezone: "Asia/Jerusalem"`.

**Step 2: Run** `pnpm vitest run src/components/onboarding/first-artist-simulation/__tests__/simulation-model.test.ts` → FAIL (frames, fields missing).

**Step 3: Implement** in `simulation-model.ts`:
- `SimulationInput.timezone: string` (IANA).
- `SimulationFrameId = "store" | "approve" | "agreement" | "pay" | "verify" | "music" | "sessions" | "dashboard" | "closing"`.
- `SIMULATION_IDS` += `allowance`, `session`, `track`, `versionOne`, `versionTwo`, `commentOne`, `commentTwo`, `request` (obviously fake, same style).
- Pure helpers (exported): `previewPeaks(offset)` (copy of `components/dev/sk8-music-dev-screen.tsx:46`), `zonedInstant({ year, month, day, hour, minute, timeZone })` via `Intl.DateTimeFormat(...).formatToParts` offset correction, `zonedDateParts(instant, timeZone)` → `{ year, month, day, weekday }`, `nextWorkingDay(now, tz)` (tomorrow; skip Fri/Sat).
- `SILENT_AUDIO_DATA_URL` = 44-byte silent WAV data URI so versions count as playable without any network.
- Model fields: `includesStudioTime: boolean` (`durationMin > 0` per PRD "product is the parent of session time"), `song: { data: SongPageData; approved: SongPageData }`, `booking: { availability, studios, activePackages, allowanceId }` (shapes from `app/(artist)/artist/book/booking-client.tsx:64-71`), `session: { item: SessionListItem; allowance: AllowanceSummary; nowISO: string }`, `dashboard: { now, pulseStats, todaySession, recentUploads }`, `request: { snapshot: PurchaseCommercialSnapshot; submittedAtLabel: string; totalLabel: string }`.
- `buildFrames` rewritten with the captions from the design, `step` renumbered after filtering out `sessions` when `!includesStudioTime`.
- Keep `simulatedCharges`, `chooseStoryPlan`, `toSimulationPurchaseProduct`, `svgReceipt`, proof review, `EXAMPLE_PAYMENT_DETAILS` as they are.

**Step 4: Run** the model test → PASS. **Step 5: Commit** `feat(onboarding): model the 8-frame first-artist story (SK-298)`.

---

### Task 2: Seam — `PurchaseRequestReview.onPreviewDecision`

**Files:**
- Modify: `components/dashboard/requests/purchase-request-review.tsx:36-66,116-167`
- Test: `components/dashboard/requests/__tests__/purchase-request-review.preview.test.tsx` (new)

**Step 1: Failing test** — render with `onPreviewDecision`, mock `~/app/(producer)/dashboard/requests/actions` with spies and `next/navigation`; click "Approve" then "Approve request"; expect the spy called with `"approve"`, status pill "Approved", no server action, no `router.push`.

**Step 3: Implement** — prop `onPreviewDecision?: ((decision: "approve" | "decline") => void) | undefined` (doc: "Development gallery and simulation only: avoids real mutations"). In `runApprove` and `runDecline`, after the offline guard and before `startTransition`: if the seam exists → `setStatus("approved"|"declined"); setConfirmation(null); onPreviewDecision(...); return;`.

**Step 5: Commit** `feat(requests): preview decision seam on PurchaseRequestReview (SK-298)`.

---

### Task 3: Seam — `ReviewAgreeScreen.defaultAccepted`

**Files:**
- Modify: `components/artist/purchase/review-agree-screen.tsx:42-57,189`
- Test: `components/artist/purchase/__tests__/review-agree-screen.preview.test.tsx` (new)

**Step 1: Failing test** — gallery arm with `defaultAccepted`, expect the CTA "Accept exact agreement" enabled and its sub copy "Creates the purchase with these frozen terms"; without the prop it is disabled.

**Step 3: Implement** — add `defaultAccepted?: boolean | undefined` to `GalleryReviewProps` (and `defaultAccepted?: never` to `ExactReviewProps`); `useState(!isExactReview(props) && props.defaultAccepted === true)`.

**Step 5: Commit** `feat(purchase): let the gallery agreement screen start accepted (SK-298)`.

---

### Task 4: Overlay — the 8 frames

**Files:**
- Modify: `components/onboarding/first-artist-simulation/first-artist-simulation.tsx`
- Modify tests: `__tests__/first-artist-simulation.source.test.ts`, `__tests__/first-artist-simulation.interaction.test.tsx`

**Step 1: Update the source contract first** (it is the spec): required tags `ProducerHero`, `FocalProductCard`, `PurchaseRequestReview`, `PurchaseRequestCommercialDetails`, `ReviewAgreeScreen`, `PaymentInstructionsScreen`, `PaymentProofReview`, `SongPage`, `BookingClient`, `ConfirmationHero`, `MySessionsScreen`, `OverviewScreen`, `RuntimeStatePreviewProvider`; literals `previewSentHref={INERT_HREF}`, `previewReference={SIMULATION_IDS.requestRef}`, `previewProofHref={INERT_HREF}`, `onPreviewDecision={handleProofDecision}`, `onPreviewDecision={handleRequestDecision}`, `defaultAccepted`, `previewOnly`; forbid `~/server/` imports, `useMutation|createCaller|fetch(`, `router.(push|replace)`, `framer-motion|@keyframes`; keep the `inert aria-hidden`, `SIMULATION_LABEL`, "Nothing was sent or saved.", `sk-step-enter`, viewport-token assertions. Drop the removed components from the list.

**Step 2: Rewrite the interaction test** for the new walk (captions from the model): Store → Next → approve (`simulation-producer-panel`, click "Approve", then "Approve request", `waitFor` agreement caption) → agreement (`waitFor` the enabled "Accept exact agreement" button after the beat) → Next → pay → Next → verify ("Confirm ₪900" → "Confirm payment" → `waitFor` music caption) → music (`waitFor` text "Approved" after the beat; comment "0:42" present) → Next → sessions (`waitFor` "You're booked") → Finish → dashboard? No: dashboard is the last numbered frame, so Next on sessions goes to dashboard and **Finish** on dashboard opens the closing card. Assert: label on every frame, artist frames `inert`, producer panels not inert, `simulation_step` × 8, links/clipboard as before, no fetch/push/server action (add the request-actions spies). Keep the Bit-details test (3 × Next to reach pay) and the early-exit test (ids `approve`/`agreement`).

**Step 3: Implement the overlay:**
- Imports: replace the removed screens with `PurchaseRequestReview`, `PurchaseRequestCommercialDetails`, `SongPage`, `BookingClient`, `ConfirmationHero`, `MySessionsScreen`, `OverviewScreen`, `RuntimeStatePreviewProvider`.
- `ARTIST_TABS(active)` becomes a function; `ScreenArea`/`ArtistDevice` take `tab?: "store" | "music" | "sessions"`.
- `ProducerWindow`'s scroll container gets `style={SCREEN_AREA_STYLE}` so the request review's fixed phone action bar stays inside the window; it renders an optional `<PushToast text>` first (the bell row from the old `NeedsYouFrame`, `role="status"`, `sk-step-enter`).
- `ActedFrame({ children: (acted) => ReactNode })`: `useState(false)`; effect: reduced motion → `setActed(true)` at once, else `setTimeout(…, ACT_DELAY_MS = 1100)`; the frame container is keyed by `frame.id`, so navigating back replays the beat.
- `const SIMULATION_IDENTITY = { userId: "simulation-artist", role: "artist", contextId: SIMULATION_IDS.project }` for `RuntimeStatePreviewProvider` around `SongPage` and `MySessionsScreen`; a producer twin around `OverviewScreen`.
- `renderFrame` cases: `store` (unchanged, `tab="store"`), `approve` (`ProducerWindow` + toast "Noya Levi requested {product}." + `PurchaseRequestReview` with `id={SIMULATION_IDS.request}`, `initialStatus="pending"`, `initialProjectId={null}`, `targetProjects={[]}`, artist name/email `noya@example.invalid`… use `noya.levi@skitza.invalid`, `total={model.request.totalLabel}`, `totalCaption="Proposal total"`, `submittedAt={model.request.submittedAtLabel}`, `reference={SIMULATION_IDS.requestRef}`, `brief="Debut single. I want it warm, live drums if we can."`, children `<PurchaseRequestCommercialDetails commercialTerms={{ kind: "proposal", snapshot: model.request.snapshot }} />`, `onPreviewDecision={handleRequestDecision}`), `agreement` (`ActedFrame` → `ReviewAgreeScreen key={acted ? "accepted" : "pending"} defaultAccepted={acted} …`), `pay` (unchanged), `verify` (toast "Noya Levi sent a payment proof for Blue Hour." + `PaymentProofReview`), `music` (`ArtistDevice standing tab="music"` → `ActedFrame` → provider → `<SongPage role="artist" data={acted ? model.song.approved : model.song.data} actions={SONG_ACTIONS} />` where `SONG_ACTIONS = { approveVersion: () => Promise.resolve({ ok: true }) }`), `sessions` (`ArtistDevice standing tab="sessions"` → `ActedFrame` → before: `<BookingClient …model.booking… initialSessionAllowanceId={model.booking.allowanceId} rescheduleSessionId={null} />`; after: `<div className="space-y-4 px-4 pt-4"><ConfirmationHero session={model.session.item} /><MySessionsScreen sessions={[model.session.item]} allowances={[model.session.allowance]} nowISO={model.session.nowISO} previewOnly /></div>`), `dashboard` (`ProducerWindow` + toast "Noya Levi approved Blue Hour v2." + provider → `<OverviewScreen displayName={producer.name} slug={null} timezone={input.timezone} pulseStats={…} paymentProofs={[]} paymentBalances={[]} purchaseRequests={[]} pendingApprovals={[]} todaySession={…} urgentProjects={[]} recentUploads={…} unresolvedItems={[]} dismissals={[]} showSetupNudge={false} showAllNeedsYou={false} now={…} />`), `closing` unchanged.
- Handlers: `handleRequestDecision(decision)` → on `"approve"` advance to the next frame after 700 ms (like the proof beat); `handleProofDecision` → next frame instead of `"outcome"`.
- Delete `NeedsYouFrame`, `OutcomeFrame`, the `money` helper if unused, unused icons.

**Step 4: Run** both overlay tests and the model test → PASS. **Step 5: Commit** `feat(onboarding): play the 8-frame story through the live Music, Sessions and dashboard screens (SK-298)`.

---

### Task 5: Entry point — timezone through the complete page

**Files:**
- Modify: `app/(onboarding)/onboarding/complete/simulation-input.ts` (`CompletionProfile.timezone: string | null`; `timezone: profile.timezone ?? "Asia/Jerusalem"`), `app/(onboarding)/onboarding/complete/page.tsx` (pass `profile.timezone`), `simulation-model.ts` `PREVIEW_SIMULATION_INPUT.timezone`.
- Test: `app/(onboarding)/onboarding/complete/__tests__/simulation-input.test.ts` (timezone mapped, fallback when null).

**Commit** `feat(onboarding): feed the studio timezone into the simulation (SK-298)`.

---

### Task 6: Gate, screenshots, review

1. `pnpm typecheck && pnpm lint && pnpm test` (apps/web), `pnpm typecheck` (packages/db). Fix everything; never hide a failure.
2. Dev server from the worktree on port 3001 (`.claude/launch.json` entry `web-sk298`, temporary), Playwright walk at 390 / 360 / 1440 with the scratchpad `walk.mjs` (click order: Next, Approve → Approve request, Next, Next, Confirm ₪900 → Confirm payment, Next, Next, Finish). Contact sheets to Gili.
3. Revert `.claude/launch.json`. Commit the design + plan docs. Push the branch, open the PR `SK-298: Watch your first artist simulation` against `v3-clean`. Do not merge without Gili.
