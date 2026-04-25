# Story 05 — Step 3: Availability (reuses AvailabilitySection)

> Skitza-BMAD · Story 05 of 10
> Architecture: §4.4
> **Depends on:** Stories 02 (shell) + 03 (Step 1)

---

## As a producer at Step 3 of onboarding...

I want to set my weekly hours, default session length, cancellation policy, and see (eventually-real) Google Calendar status — using the exact same surface I'd use later in Setup → Availability.

## Acceptance criteria

- [ ] `/onboarding/availability` renders shell (currentStep=3, title "When are you open?").
- [ ] Renders `<AvailabilitySection blocks={blocks} blackouts={blackouts} settings={settings} />` from `~/components/dashboard/setup/availability-section`.
- [ ] Initial data fetched server-side: `blocks = []` if no rows yet, `blackouts = []` if none, `settings = {defaultSessionMin, autoConfirmBookings, cancellationPolicyHours}` from the producer row's existing defaults (60 / false / 24).
- [ ] All 5 child editors (GCal stub, duration picker, policies, weekly windows, blackouts) render and persist via their existing tRPC mutations.
- [ ] GCal sync button still opens "coming soon — notify me" modal (no change to that component).
- [ ] Action bar: Back, Skip for now, Continue → /onboarding/portfolio.
- [ ] Continue is always enabled — the producer can advance with whatever they've configured (the children already auto-save on change).
- [ ] Step-aware decide-redirect (Story 04) covers this route too.
- [ ] Telemetry: step_completed / step_skipped with `{ step: "availability" }`.

## Technical context

### Files to touch

**Create:**
- `apps/web/src/app/(onboarding)/onboarding/availability/page.tsx` — fetches blocks + blackouts + settings server-side, passes them in.
- `apps/web/src/app/(onboarding)/onboarding/availability/__tests__/page.test.tsx` — minimal smoke (renders without crashing, AvailabilitySection mounted).

**Modify:**
- None expected. AvailabilitySection is a server component already; its 5 children are client islands with their own optimistic-update behavior. They already write to the producer row scoped by ctx.producerId.

### Page implementation outline

```tsx
// availability/page.tsx
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { AvailabilitySection } from "~/components/dashboard/setup/availability-section";
import { OnboardingShell } from "../shell";
import { fetchUserRole } from "~/server/auth/role";
import { decideOnboardingRedirect } from "../decide-redirect";

export default async function Step3Page() {
  const { userId } = await auth();
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) throw new Error("missing DATABASE_URL");
  const role = await fetchUserRole({ dbUrl, userId });
  const redirectTo = decideOnboardingRedirect(role, "availability");
  if (redirectTo) redirect(redirectTo);
  if (role.kind !== "producer-complete" && role.kind !== "producer-incomplete") return null;

  // Fetch settings from producer row + blocks/blackouts via Drizzle (read-only)
  const data = await fetchAvailabilityData(role.producer.id, dbUrl);

  return (
    <OnboardingShell
      currentStep={3}
      title="When are you open?"
      onBack={...}
      onSkip={...}
      onContinue={...}
    >
      <AvailabilitySection {...data} />
    </OnboardingShell>
  );
}
```

`fetchAvailabilityData` is a small server-side helper (can live in `availability/data.ts` or inline) — selects from `availability_blocks` + `blackouts` + reads the relevant producer columns.

### Conventions

- The 5 child editors handle their own writes via existing tRPC; this page just renders them.
- Children already enforce `producerProcedure` server-side (verify with grep before assuming) — auth scoping is preserved by reuse.
- No new tRPC procedures, no new schema, no new mutations.

## TDD steps

Smoke-only test: render the page with a mocked role + mocked db reads, assert AvailabilitySection mounts. Heavier behavior is already covered by the existing children's tests in `apps/web/src/app/(app)/dashboard/booking/__tests__/`.

## Commit

```bash
git commit -m "$(cat <<'EOF'
feat(onboarding): step 3 — availability via AvailabilitySection reuse

Wizard's Step 3 renders the existing AvailabilitySection composite
(setup/availability-section.tsx) and its 5 child editors:
  • GCal sync stub badge (per §18.1 — stays "coming soon")
  • Default session duration picker
  • Session policies (auto-confirm + cancellation hours)
  • Weekly windows editor
  • Blackouts editor

Each child island handles its own writes via existing producerProcedure
mutations — no new server code. Producer's data here is identical in
shape to what Setup → Availability would later edit.

Continue is always enabled (children auto-save). Skip-for-now advances
without saving anything fresh.

Story 05 of 10 — `feat/onboarding-rebuild`.

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

## QA review checklist

### Spec compliance

- [ ] AvailabilitySection rendered with empty arrays if no rows
- [ ] Children's existing tests still pass (no regression)
- [ ] decide-redirect step-aware behavior covers this route
- [ ] Skip works without writes

### Code quality

- [ ] Server-side fetch is a single round trip (or two parallel) — not N+1
- [ ] Reuses existing types (AvailabilityBlock, Blackout, AvailabilitySettings) from `availability-section.tsx`
