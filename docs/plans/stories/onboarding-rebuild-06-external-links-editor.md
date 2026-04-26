# Story 06 — External links editor (Spotify / YouTube / Instagram)

> Skitza-BMAD · Story 06 of 10
> Architecture: §4.5, §5
> **Depends on:** Story 02 (shell primitives, optional)

---

## As a producer at Step 4 of onboarding...

I want to drop in my Spotify / YouTube / Instagram links so visitors to my public profile can hear my work elsewhere — without leaving the onboarding flow.

## Acceptance criteria

- [ ] New component `<ExternalLinksEditor producerId={...} initialLinks={[]} onSave={...} />` renders 3 inputs:
  - **Spotify** (placeholder `https://open.spotify.com/artist/...`)
  - **YouTube** (placeholder `https://youtube.com/@yourhandle`)
  - **Instagram** (placeholder `https://instagram.com/yourhandle`)
- [ ] Each input has a small platform icon prefix (use existing icon set or inline SVG).
- [ ] All three inputs are optional. URL validation is lenient: must start with `http://` or `https://` if non-empty.
- [ ] Save button at bottom. On save, calls a server action that:
  1. For each non-empty URL: looks up existing row by `(producerId, platform)` — if exists, updates `url`; if not, inserts.
  2. For empty URLs: deletes any existing row with that platform (so blanking out clears it).
- [ ] Auth scoped via `producerProcedure` (or server action with the same scoping pattern).
- [ ] After save, `onSave()` callback is called for the parent step page.
- [ ] Reuse this component later in Setup → Profile (NOT in this story — but design for it).
- [ ] Tests assert: input rendering, lenient validation, server-action mutation shape.

## Technical context

### Files to touch

**Create:**
- `apps/web/src/components/onboarding/external-links-editor.tsx` — the controlled form component.
- `apps/web/src/components/onboarding/__tests__/external-links-editor.test.tsx` — RTL tests.
- `apps/web/src/app/(onboarding)/onboarding/portfolio/links-actions.ts` — server action `saveExternalLinks` (could also live as a tRPC mutation if cleaner — pick whichever matches the existing `producer-external-links.ts` router pattern).

**Modify:**
- None to existing components. Possibly extend `producer-external-links.ts` router with a `bulkSave` procedure if it doesn't already have one — verify by reading first.

### Server action contract

```ts
"use server";
async function saveExternalLinks(input: {
  links: { platform: "spotify" | "youtube" | "instagram_reels"; url: string }[];
}): Promise<void>;
```

Implementation:
1. `auth()` for userId; reject if missing
2. Resolve producerId via `fetchUserRole` (must be `producer-incomplete` or `producer-complete`)
3. For each input link:
   - if `url === ""`: DELETE FROM producer_external_links WHERE producerId = ctx.producerId AND platform = link.platform
   - else: INSERT … ON CONFLICT (producerId, platform) DO UPDATE SET url = EXCLUDED.url

(The `producer_external_links` table has no current unique on `(producer_id, platform)`. Verify the schema; if missing, this story may need a migration adding one. Handle this by reading the table definition first — see arch doc §3.)

### Test strategy

`external-links-editor.test.tsx`:
- renders 3 inputs
- typing into Spotify → state updates
- save with no URLs → action called with `links: []`
- save with one URL → action called with `links: [{platform: "spotify", url: "..."}]`
- invalid URL (no http://) → inline error, save blocked

`links-actions.test.ts` (or extend existing producer-external-links router test):
- mocks DB via marker pattern
- assert each link's INSERT/UPDATE WHERE includes `eq(producerExternalLinks.producerId, ctx.producerId)` (use `findPredicate`)
- assert empty URL → DELETE called

### Schema check needed

Story author should verify whether `(producer_id, platform)` is a unique constraint on `producer_external_links`. If not, two options:
- (a) Add it via a new migration `0029_external_links_unique.sql` (idempotent: `ADD CONSTRAINT IF NOT EXISTS`). Apply via `/skitza-migrate`.
- (b) Use a SELECT-then-INSERT-or-UPDATE pattern (race-prone but acceptable for v1 since each producer is the only writer).

Recommendation: **(a)** — clean DB invariant, ~5 lines of SQL. Migration file template in CLAUDE.md § Database & migrations.

### Conventions

- CSS vars only
- 44px tap targets
- Inputs use existing `~/components/ui/input` primitives
- Save button uses existing `~/components/ui/button`

## TDD steps

Standard. Tests for the editor (~5 cases) + the action (~3 cases).

## Commit

```bash
git commit -m "$(cat <<'EOF'
feat(onboarding): external links editor for portfolio step

New component <ExternalLinksEditor /> with 3 platform inputs (Spotify,
YouTube, Instagram). Bulk-save server action upserts non-empty URLs and
deletes empty-string URLs (so producers can clear a link by clearing
the input).

Auth scoped via producerProcedure pattern: producerId always pulled
from ctx, never trusted from input. Reusable in Setup → Profile later
(this story doesn't wire that surface).

[If migration was added:] Adds unique constraint on
(producer_id, platform) so the upsert is race-safe.

Story 06 of 10 — `feat/onboarding-rebuild`.

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

## QA review checklist

### Spec compliance

- [ ] All 3 platforms exposed with correct enum values
- [ ] Empty URL deletes existing row (regression-test this — easy to miss)
- [ ] Auth scoping verified via `findPredicate`
- [ ] Lenient http(s) validation, no regex hell

### Code quality

- [ ] Component is fully controlled (state in parent? local? — pick one and document)
- [ ] No prop drilling beyond 1 level
- [ ] Reuses existing input primitives

## Story author note (read before dispatch)

The `producer_external_links` table schema lives at `packages/db/src/schema.ts:777`. Before writing the upsert, RUN: `grep -nE "unique\(\"producer_external_links_(producer|platform)" packages/db/src/schema.ts` to verify whether the unique constraint exists. The platform enum has 7 members but this wizard only exposes 3 of them (`spotify`, `youtube`, `instagram_reels`).
