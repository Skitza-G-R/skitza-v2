# Admin console: three real tabs

**SK-288** · 29 Aug 2026 · approved by Gili

## The problem

`admin.skitza.app` has six tabs. Two read the database. Four are hardcoded
fixtures — invented people ("Maya Levi", "Noah Cohen"), invented numbers, and
buttons that render `Simulated / reset on reload`.

| Tab | Backed by |
| --- | --- |
| Users | real — `registered-users` runtime |
| Beta | real — `beta` runtime (SK-273/274) |
| Overview *(home)* | `createFixtureAdminRepository` — fake |
| Payments | fake |
| Analytics | fake |
| Health & history | fake |

The home page — the first screen on every visit — is one of the fake ones.
Nothing in the sidebar distinguishes a real tab from a pretend one.

Two further findings:

- `src/features/dashboard/users-view.tsx` is 1,423 lines with **zero
  importers**. It is the old fake Users screen, replaced by the real one and
  never deleted.
- The `[environment]` Live/Test split demands a separate database, Clerk
  account, and Resend key per environment. `ADMIN_TEST_RESEND_API_KEY` is a
  documented placeholder, so a Test-environment invite send fails by design.
  Test is not a sandbox; it is a costume.

## What the console is actually for

Gili was grilled on the four jobs the six tabs claim to serve. The answers
reshaped the design:

- **Running beta waves** — real. Happens. Tab is real.
- **Looking one person up** — real. Happens when someone emails. Tab is real.
- **"Is anything broken?"** — Gili *never checks*. Not in admin, not in
  Sentry, not anywhere. It surfaces only after something has already gone
  wrong.
- **"How are we growing?"** — same. Never checked.
- **Notifications** — explicitly not wanted.

The two tabs that are real are the two that get opened. The four fake ones map
to jobs nobody performs. They were never finished because there was never a
reason to open them.

### The consequence

Gili does not pull, and will not accept push. There is therefore exactly one
moment when the console can communicate anything: the instant it is opened for
some *other* reason — sending a wave, or looking someone up.

That makes the home screen the entire surface area. Not a vanity page. The
doorway walked through on every visit, and today it is fiction.

Two recent, expensive proofs that this matters:

- **SK-287** — every production email was refused for an unknown stretch of
  time. Found by accident.
- **SK-282** — a job scheduled every 15 minutes has never run once in this
  repository's history. Found by accident.

Neither would have been caught by a dashboard, because the dashboard would not
have been opened. Both would have been caught by a true home screen, seen for
free on the way to Beta.

## Target

Three tabs. No environment switcher.

### 1 · Home

Real data only. Answers **"what is waiting on me, and what is broken"** — not
growth metrics.

- **Broken** — email sends failing (the SK-287 hole); a scheduled job that has
  not run when it should have (the SK-282 hole).
- **Stuck people** — producers who began onboarding days ago and never
  finished; beta invites nobody acted on.
- **An explicit "Nothing needs you" empty state.** A screen that always shows
  something gets ignored within a week. The quiet state is the feature.

Every row must be something Gili can act on and cannot see anywhere else.
Anything PostHog, Sentry, or Resend already reports does not belong here.

### 2 · Users

Unchanged. Already real.

### 3 · Beta

Unchanged. Already real.

## Deleted

Analytics, Payments, Health & history, `users-view.tsx`, and the whole
fixture layer: `admin-demo-view-models`, `demo-repository`, `operations-demo`,
`user-demo-workflows`, plus the demo pieces of `dashboard-interactions`
(`SimulatedNotice` and friends).

Roughly 3,700 lines — about 15% of the admin app, and 100% of the part that
lies.

**Payments** is deleted rather than built because verifying payment proofs is
the producer's job in the producer app. The founder has no role in it.

**Analytics** is deleted rather than built because PostHog already does it and
Gili does not look at either.

## Live/Test collapses to one

The `[environment]` route segment and every `ADMIN_TEST_*` binding are removed.
Admin talks to the live database.

Removing the split drops ten-plus duplicated settings that must otherwise be
kept in sync forever, and takes `/live/` out of every URL.

**Accepted trade-off.** A Test environment's real value is rehearsing a
destructive action before doing it for real, and re-adding the split later is
genuine work. Accepted anyway: admin is almost entirely reads plus invite
sends, and Test cannot rehearse an invite send — its Resend key is a
placeholder. The right guard for "email 200 people" is a confirmation step on
that one button, not a parallel copy of the application.

## Open before building

What `ADMIN_TEST_DATABASE_URL` points at in the admin Vercel project. The app
refuses to boot unless Live and Test resolve to different Postgres targets, and
the only other database in the account is the one labelled
`OLD — DO NOT USE.` Worth knowing regardless of this issue.
