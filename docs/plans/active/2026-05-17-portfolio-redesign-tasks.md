# Portfolio Page Redesign — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Rebuild `/dashboard/portfolio` as a desktop-only, single-screen showcase canvas with two columns (social links left, featured tracks right), smart-paste link entry, ▲▼ reorder, and a "View public page ↗" header pill.

**Architecture:**
No schema migration. Reuses `portfolioTracks.position`, `producerExternalLinks.position`, existing bulk `reorder({ orderedIds[] })` mutations, existing R2 audio plumbing for play, and the existing `is_public_sample` boolean (UI exposes only a passive "Public" badge — see §0.2 Q1=B in the design doc). The only real backend change is simplifying `producerExternalLinks.add` to accept `{ url }` only and detecting the platform server-side via a new pure helper.

**Tech Stack:**
Next.js 15 App Router, tRPC v11 with `producerProcedure` ownership guards, Drizzle + Neon, React 19 client components, Tailwind v4 with Skitza CSS tokens (`--bg-base`, `--bg-elevated`, `--fg-primary`, `--brand-primary`, `--radius-lg`, etc — see `feedback_skitza_css_tokens.md`), Vitest + React Testing Library.

**Design doc:** `docs/plans/active/2026-05-17-portfolio-redesign-design.md` — read §0 (build-session decisions) before each task.

---

## Pre-flight (do once)

- Verify worktree is at `origin/v3-clean` HEAD on branch `portfolio-redesign`.
- Verify `pnpm install` was run on the worktree (it was created from a tracked branch, so node_modules need to be installed).

```bash
cd /Users/giliasraf/skitza-portfolio-redesign
git status -sb   # expect: ## portfolio-redesign...origin/v3-clean
pnpm install --frozen-lockfile
```

---

## Task 1: Platform detector library

**Why:** Server-side smart-paste needs a pure function that turns a URL into one of the seven supported `ExternalPlatform` enum values, or `null` for unknown hosts. Pure function = trivial to test in isolation.

**Files:**
- Create: `apps/web/src/lib/external-links/detect-platform.ts`
- Create: `apps/web/src/lib/external-links/__tests__/detect-platform.test.ts`

**Step 1 — Write the failing test:**

```ts
// apps/web/src/lib/external-links/__tests__/detect-platform.test.ts
import { describe, expect, it } from "vitest";
import { detectPlatform } from "../detect-platform";

describe("detectPlatform", () => {
  it.each([
    ["https://open.spotify.com/track/abc", "spotify"],
    ["https://spotify.com/artist/x", "spotify"],
    ["https://music.apple.com/us/album/y", "apple_music"],
    ["https://www.youtube.com/watch?v=z", "youtube"],
    ["https://youtu.be/z", "youtube"],
    ["https://soundcloud.com/foo/bar", "soundcloud"],
    ["https://bandcamp.com/x", "bandcamp"],
    ["https://tidal.com/browse/track/1", "tidal"],
    ["https://www.instagram.com/reel/abc/", "instagram_reels"],
  ])("maps %s -> %s", (url, expected) => {
    expect(detectPlatform(url)).toBe(expected);
  });

  it("returns null for unknown hosts", () => {
    expect(detectPlatform("https://vimeo.com/123")).toBeNull();
  });

  it("returns null for malformed URLs without throwing", () => {
    expect(detectPlatform("not a url")).toBeNull();
    expect(detectPlatform("")).toBeNull();
  });

  it("is case-insensitive on host", () => {
    expect(detectPlatform("https://OPEN.SPOTIFY.COM/track/abc")).toBe("spotify");
  });
});
```

**Step 2 — Run test, verify fails:**

```bash
pnpm -F web vitest run apps/web/src/lib/external-links/__tests__/detect-platform.test.ts
# Expected: FAIL — Cannot find module '../detect-platform'
```

**Step 3 — Minimal implementation:**

```ts
// apps/web/src/lib/external-links/detect-platform.ts
import type { ExternalPlatform } from "@skitza/db";

const HOST_MAP: Record<string, ExternalPlatform> = {
  "spotify.com": "spotify",
  "open.spotify.com": "spotify",
  "music.apple.com": "apple_music",
  "youtube.com": "youtube",
  "www.youtube.com": "youtube",
  "youtu.be": "youtube",
  "soundcloud.com": "soundcloud",
  "www.soundcloud.com": "soundcloud",
  "bandcamp.com": "bandcamp",
  "tidal.com": "tidal",
  "www.tidal.com": "tidal",
  "instagram.com": "instagram_reels",
  "www.instagram.com": "instagram_reels",
};

export function detectPlatform(url: string): ExternalPlatform | null {
  let host: string;
  try {
    host = new URL(url).host.toLowerCase();
  } catch {
    return null;
  }
  return HOST_MAP[host] ?? null;
}
```

**Step 4 — Run, verify passes:**

```bash
pnpm -F web vitest run apps/web/src/lib/external-links/__tests__/detect-platform.test.ts
# Expected: all tests pass
```

**Step 5 — Commit:**

```bash
git add apps/web/src/lib/external-links/
git commit -m "feat(portfolio): add detect-platform helper for smart-paste link input"
```

---

## Task 2: Simplify `producerExternalLinks.add` to URL-only

**Why:** Doc §0.2 wants `{ url }` only. Server detects platform via Task 1's helper. Unknown URL → `BAD_REQUEST` with the doc's exact copy. Existing duplicate-platform constraint (`producer_external_links_producer_platform_unique`) raises a friendlier message too.

**Files:**
- Modify: `apps/web/src/server/trpc/routers/producer-external-links.ts`
- Modify: `apps/web/src/server/trpc/routers/__tests__/producer-external-links.test.ts`

**Step 1 — Update tests (red):**

Replace the existing `add` tests with the URL-only contract. Keep all other test blocks intact.

Cover:
- Known URL: inserts with correct detected platform, `title: null`, returns the row.
- Unknown host: throws `BAD_REQUEST` with message `"We don't recognise that platform yet."`
- Malformed URL: rejected by zod `url()` validator with field path `url`.
- Duplicate platform for same producer: throws `BAD_REQUEST` with `"You already have a {platform} link. Remove the old one first."` (server catches the unique-constraint error and rewraps).
- Cross-tenant ownership: covered by the ownership guard already on the procedure.

**Step 2 — Run, verify fails:**

```bash
pnpm -F web vitest run apps/web/src/server/trpc/routers/__tests__/producer-external-links.test.ts
# Expected: FAIL — input shape rejected / detection not called
```

**Step 3 — Minimal implementation:**

```ts
// apps/web/src/server/trpc/routers/producer-external-links.ts
// New input schema
const AddInput = z.object({
  url: z.string().url().min(10).max(500),
});

// In the router:
add: producerProcedure
  .input(AddInput)
  .mutation(async ({ ctx, input }) => {
    const platform = detectPlatform(input.url);
    if (!platform) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "We don't recognise that platform yet.",
      });
    }
    try {
      const [row] = await ctx.db
        .insert(producerExternalLinks)
        .values({
          producerId: ctx.producerId,
          platform,
          url: input.url,
          title: null,
          position: 0,
        })
        .returning();
      if (!row) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      return row;
    } catch (err) {
      if (isUniquePlatformViolation(err)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `You already have a ${PLATFORM_LABEL[platform]} link. Remove the old one first.`,
        });
      }
      throw err;
    }
  }),
```

Add `detectPlatform` import. Add `isUniquePlatformViolation` helper that inspects the pg error code `23505` and constraint name. Add `PLATFORM_LABEL` map for the friendly error message.

**Step 4 — Run, verify passes:**

```bash
pnpm -F web vitest run apps/web/src/server/trpc/routers/__tests__/producer-external-links.test.ts
# Expected: PASS
```

**Step 5 — Commit:**

```bash
git add apps/web/src/server/trpc/routers/producer-external-links.ts \
        apps/web/src/server/trpc/routers/__tests__/producer-external-links.test.ts
git commit -m "feat(portfolio): producerExternalLinks.add now takes URL only + detects platform"
```

---

## Task 3: Default `isPublicSample: true` in `portfolio.create`

**Why:** Q1=B locked. New tracks added through the portfolio page are automatically public on /join (since that page IS the curation). Existing private rows stay private — no backfill. The Music page can still flip the flag later if a separate surface exposes it.

**Files:**
- Modify: `apps/web/src/server/trpc/routers/portfolio.ts:56-62`
- Modify: `apps/web/src/server/trpc/routers/__tests__/portfolio.test.ts`

**Step 1 — Write failing test:**

```ts
// in portfolio.test.ts
it("create defaults isPublicSample to true", async () => {
  const caller = makeCaller(/* producer ctx */);
  const row = await caller.portfolio.create({
    title: "New banger",
    audioUrl: "https://example.com/x.mp3",
  });
  expect(row.isPublicSample).toBe(true);
});
```

**Step 2 — Run, verify fails:**

```bash
pnpm -F web vitest run apps/web/src/server/trpc/routers/__tests__/portfolio.test.ts -t "create defaults isPublicSample"
# Expected: FAIL — default in schema is false
```

**Step 3 — Implementation:**

In `portfolio.ts` `create` mutation, change the insert values to set `isPublicSample: true` explicitly (only when the input doesn't override it):

```ts
const [row] = await ctx.db
  .insert(portfolioTracks)
  .values({
    ...stripUndefined(input),
    producerId: ctx.producerId,
    isPublicSample: true, // Q1=B per design doc §0.2 — featured == public
  })
  .returning();
```

**Step 4 — Run, verify passes:**

```bash
pnpm -F web vitest run apps/web/src/server/trpc/routers/__tests__/portfolio.test.ts
# Expected: PASS — including all existing tests
```

**Step 5 — Commit:**

```bash
git add apps/web/src/server/trpc/routers/portfolio.ts \
        apps/web/src/server/trpc/routers/__tests__/portfolio.test.ts
git commit -m "feat(portfolio): new featured tracks default to public-on-/join"
```

---

## Task 4: Update `actions.ts` — URL-only `addExternalLink`, new reorder wrappers

**Why:** UI layer mirror of Tasks 1+2. The reorder wrappers wrap the existing bulk router mutations so the panel can call simple server actions.

**Files:**
- Modify: `apps/web/src/app/(producer)/dashboard/portfolio/actions.ts`

**Step 1 — Write failing test:**

No isolated test for actions (they're thin wrappers); coverage rides on the panel component test (Task 5) and the router tests (Tasks 2+3). Skip Step 1-4 for this task and move directly to the change.

**Step 2 — Edit actions.ts:**

- `addExternalLink` input shrinks from `{ platform, url, title }` to `{ url }`. Body becomes `await c.caller.producerExternalLinks.add({ url: input.url })`.
- Add `reorderPortfolioTracks(input: { orderedIds: string[] }): Promise<ActionResult>` that calls `c.caller.portfolio.reorder({ orderedIds: input.orderedIds })` and revalidates.
- Add `reorderExternalLinks(input: { orderedIds: string[] }): Promise<ActionResult>` that calls `c.caller.producerExternalLinks.reorder({ orderedIds: input.orderedIds })` and revalidates.
- `updatePortfolioTrack` and `deletePortfolioTrack` stay as-is (used by the music library / future surfaces).

**Step 3 — Quick smoke test:**

```bash
pnpm -F web typecheck
# Expected: clean — calls into the new add() signature compile
```

**Step 4 — Commit:**

```bash
git add apps/web/src/app/(producer)/dashboard/portfolio/actions.ts
git commit -m "feat(portfolio): actions wrap reorder; addExternalLink takes URL only"
```

> Note: typecheck WILL fail until Task 5 lands because the existing panel still passes `platform` + `title` to `addExternalLink`. Land Task 5 immediately after this commit, OR squash Tasks 4 + 5 into one commit. Recommend squash.

---

## Task 5: Rebuild `portfolio-panel.tsx` (the big one)

**Why:** This is the redesign. Replace the current vertical-stack panel with the locked 2-col Option 1 layout. Includes smart-paste input, ▲▼ reorder, Public badge, decorative mini waveform, motion choreography, and cap enforcement.

**Files:**
- Modify: `apps/web/src/app/(producer)/dashboard/portfolio/portfolio-panel.tsx`
- Create: `apps/web/src/app/(producer)/dashboard/portfolio/__tests__/portfolio-panel.test.tsx`

**Composition:**

```
<PortfolioPanel>
  <div className="grid grid-cols-[minmax(0,38fr)_minmax(0,62fr)] gap-10">
    <LeftColumn>
      <SocialLinksSection />
    </LeftColumn>
    <RightColumn>
      <FeaturedTracksSection />
    </RightColumn>
  </div>
</PortfolioPanel>
```

**Section: Featured tracks (right column)**
- Header row: section label `Featured tracks` (Syne ~24px), mono helper `PICK YOUR BEST. ARROWS REORDER.`, top-right `Add from music library +` pill (disabled at 5-row cap with mono micro-label `LIMIT REACHED (5/5)`).
- Row: stacked ▲▼ arrows (24px ghost buttons, disabled at edges) → circular play/pause (28px, amber on play) → mini waveform (40 bars, deterministic from track id seed, 36px tall, amber for played portion, neutral for unplayed) → title (body 600) + artist (12px muted) stacked → duration mono right-aligned → "Public" mono badge if `isPublicSample` → hover-revealed `×` remove.
- Empty state: dashed `rounded-[var(--radius-lg)]` outline, mono micro-text `NO FEATURED TRACKS YET. ADD ONE FROM YOUR MUSIC LIBRARY.` + ghost `Add from music library +` button inside.
- Reorder UX: clicking ▲ on row N swaps with N-1; UI builds the new orderedIds array and calls `reorderPortfolioTracks({ orderedIds })`. Optimistic UI: rows update locally first, server confirms or rolls back via `router.refresh()`.

**Section: Social links (left column)**
- Header row: section label `Social links` (Syne ~24px), mono helper `PASTE THE URL. WE FIGURE OUT THE PLATFORM.`
- Single smart-paste input: pill-shaped `rounded-full`, trailing button-in-button `Add ↗`. Enter submits.
- On unknown URL: inline message below input `We don't recognise that platform yet.`
- Row: stacked ▲▼ arrows → Phosphor Light platform icon → platform name body 600 + truncated URL 11px mono muted underneath → hover-revealed `×`.
- Empty state: dashed outline, mono micro-text `NO LINKS YET. PASTE A SPOTIFY OR YOUTUBE LINK ABOVE.`
- Reorder UX: same pattern; calls `reorderExternalLinks({ orderedIds })`.

**Motion:**
- Page entry: sections + rows fade up with 4px blur clearing, 720ms `cubic-bezier(0.32, 0.72, 0, 1)`, 80ms stagger. IntersectionObserver, not scroll listener.
- Buttons: `transition-transform` with `active:scale-[0.98]`. Button-in-button trailing icon on hover: `translate-x-[2px] -translate-y-[1px] scale-105`.
- Reorder: FLIP transition. `useLayoutEffect` captures pre-swap rects, post-swap apply `transform: translateY(delta)` then animate to 0 over 240ms.

**Step 1 — Write failing component tests:**

```tsx
// apps/web/src/app/(producer)/dashboard/portfolio/__tests__/portfolio-panel.test.tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PortfolioPanel } from "../portfolio-panel";

vi.mock("../actions", () => ({
  addExternalLink: vi.fn(async () => ({ ok: true })),
  reorderExternalLinks: vi.fn(async () => ({ ok: true })),
  reorderPortfolioTracks: vi.fn(async () => ({ ok: true })),
  addPortfolioFromLibrary: vi.fn(async () => ({ ok: true })),
  removeExternalLink: vi.fn(async () => ({ ok: true })),
  deletePortfolioTrack: vi.fn(async () => ({ ok: true })),
}));

describe("PortfolioPanel", () => {
  const baseProps = {
    tracks: [
      { id: "t1", title: "Track A", artist: "Artist", isPublicSample: true,
        audioUrl: "https://x/a.mp3", durationMs: 180000 },
      { id: "t2", title: "Track B", artist: null, isPublicSample: false,
        audioUrl: "https://x/b.mp3", durationMs: 240000 },
    ],
    links: [
      { id: "l1", platform: "spotify" as const,
        url: "https://open.spotify.com/x", title: null },
    ],
    library: [],
    addedAudioUrls: [],
    publicProfileUrl: "/join/alice",
  };

  it("renders two columns: links left, tracks right", () => {
    render(<PortfolioPanel {...baseProps} />);
    expect(screen.getByText(/Social links/i)).toBeInTheDocument();
    expect(screen.getByText(/Featured tracks/i)).toBeInTheDocument();
  });

  it("shows Public badge only on public tracks", () => {
    render(<PortfolioPanel {...baseProps} />);
    const badges = screen.queryAllByText("Public");
    expect(badges).toHaveLength(1);
  });

  it("smart-paste input has no platform dropdown", () => {
    render(<PortfolioPanel {...baseProps} />);
    expect(screen.queryByRole("combobox")).toBeNull();
  });

  it("clicking ▲ on track row 2 sends swapped orderedIds", async () => {
    const { reorderPortfolioTracks } = await import("../actions");
    render(<PortfolioPanel {...baseProps} />);
    const upArrows = screen.getAllByRole("button", { name: /move up/i });
    fireEvent.click(upArrows[1]); // second row's up arrow
    expect(reorderPortfolioTracks).toHaveBeenCalledWith({
      orderedIds: ["t2", "t1"],
    });
  });

  it("up arrow on first row is disabled", () => {
    render(<PortfolioPanel {...baseProps} />);
    const upArrows = screen.getAllByRole("button", { name: /move up/i });
    expect(upArrows[0]).toBeDisabled();
  });

  it("disables Add from library at 5-track cap", () => {
    const fiveTracks = Array.from({ length: 5 }, (_, i) => ({
      id: `t${i}`, title: `T${i}`, artist: null, isPublicSample: true,
      audioUrl: `https://x/${i}.mp3`, durationMs: 180000,
    }));
    render(<PortfolioPanel {...baseProps} tracks={fiveTracks} />);
    const addBtn = screen.getByRole("button", { name: /add from music library/i });
    expect(addBtn).toBeDisabled();
  });
});
```

**Step 2 — Run, verify fails:**

```bash
pnpm -F web vitest run apps/web/src/app/\(producer\)/dashboard/portfolio/__tests__/portfolio-panel.test.tsx
# Expected: FAIL — module shape doesn't match, components missing
```

**Step 3 — Rebuild `portfolio-panel.tsx`:**

Full rewrite. Replace existing file. Skeleton:

```tsx
"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  addExternalLink, addPortfolioFromLibrary,
  deletePortfolioTrack, removeExternalLink,
  reorderExternalLinks, reorderPortfolioTracks,
  type ExternalPlatformValue,
} from "./actions";
import { useToast } from "~/components/ui/toast";

// — types —
export type PortfolioTrackRow = {
  id: string; title: string; artist: string | null;
  isPublicSample: boolean; audioUrl: string | null;
  durationMs: number | null;
};
export type ExternalLinkRow = { /* unchanged */ };
export type LibraryPickRow = { /* unchanged */ };

const TRACK_CAP = 5;
const PLATFORM_LABEL: Record<ExternalPlatformValue, string> = { /* unchanged */ };

export function PortfolioPanel(props: {
  tracks: PortfolioTrackRow[]; links: ExternalLinkRow[];
  library: LibraryPickRow[]; addedAudioUrls: string[];
  publicProfileUrl: string;
}) {
  return (
    <div className="grid grid-cols-[minmax(0,38fr)_minmax(0,62fr)] gap-10">
      <div className="space-y-8">
        <SocialLinksSection links={props.links} />
      </div>
      <div>
        <FeaturedTracksSection
          tracks={props.tracks}
          library={props.library}
          addedAudioUrls={props.addedAudioUrls}
        />
      </div>
    </div>
  );
}
```

Build the subsections per §3.5 / §3.6 of design doc. Use CSS tokens from `feedback_skitza_css_tokens.md` (do NOT use `--text-muted`, `--surface-card`, etc — they don't exist).

**Step 4 — Run, verify panel tests pass:**

```bash
pnpm -F web vitest run apps/web/src/app/\(producer\)/dashboard/portfolio/__tests__/portfolio-panel.test.tsx
# Expected: PASS
```

**Step 5 — Squash with Task 4 and commit:**

```bash
git add apps/web/src/app/\(producer\)/dashboard/portfolio/
git commit -m "feat(portfolio): rebuild panel as 2-col one-screen showcase canvas"
```

---

## Task 6: Page header — "View public page ↗" pill

**Why:** The doc's only escape hatch to validate the public render. Lives in the top-right of the page header.

**Files:**
- Modify: `apps/web/src/app/(producer)/dashboard/portfolio/page.tsx`
- Modify: `apps/web/src/app/(producer)/dashboard/portfolio/__tests__/page.test.ts`

**Step 1 — Write failing test:**

```ts
it("renders View public page pill linking to /join/<slug>", async () => {
  // page renders server-side; assert the rendered HTML contains an
  // anchor with href="/join/<slug>" and target="_blank"
});
```

**Step 2 — Run, verify fails.**

**Step 3 — Implement:**

- In `page.tsx`, fetch the producer's slug (already available via `caller.producer.getCurrent()` or similar — check current code; add the fetch alongside the existing `Promise.all` if missing).
- Render a `<a>` styled as a `rounded-full` pill, positioned top-right of header. Use button-in-button trailing arrow.

**Step 4 — Run, verify passes.**

**Step 5 — Commit:**

```bash
git add apps/web/src/app/\(producer\)/dashboard/portfolio/page.tsx \
        apps/web/src/app/\(producer\)/dashboard/portfolio/__tests__/page.test.ts
git commit -m "feat(portfolio): header pill links to public /join page"
```

---

## Task 7: Full verification gate

**Why:** Skitza's Vercel build runs ESLint with `--max-warnings 0`. Typecheck + test passing is not enough — lint must be clean too.

**Step 1 — Run /skitza-verify equivalent:**

```bash
cd /Users/giliasraf/skitza-portfolio-redesign
pnpm typecheck && pnpm -F web lint && pnpm test
```

**Expected:** all three pass cleanly.

**Step 2 — If anything fails:**

- Typecheck: read the error path; usually a missing import or stale type from the old panel shape.
- Lint: most common Skitza lint hits are `react-hooks/exhaustive-deps` and unused imports. Fix at root, do not `// eslint-disable`.
- Test: investigate root cause; do not skip.

**Step 3 — Once green, commit any fixups:**

```bash
git add -A
git commit -m "chore(portfolio): typecheck + lint fixups from rebuild"
```

(Only if there were fixups. Empty commit is fine to skip.)

---

## Task 8: Open PR

**Why:** v3-clean is production base. Direct push is blocked.

**Step 1 — Push the branch:**

```bash
git push -u origin portfolio-redesign
```

**Step 2 — Open PR with base v3-clean:**

```bash
gh pr create --base v3-clean --title "feat(portfolio): two-column showcase canvas redesign" --body "$(cat <<'EOF'
## Summary
- Rebuild `/dashboard/portfolio` as a desktop-only, single-screen 2-col layout (social links left, featured tracks right).
- Smart-paste link input: server detects platform via new `detect-platform.ts`. No more dropdown.
- ▲▼ reorder on both lists. Reuses the existing bulk `reorder({ orderedIds })` mutation.
- New featured tracks default to `isPublicSample = true` (Q1=B); existing private rows untouched. UI shows a passive "Public" badge, no toggle.
- "View public page ↗" pill in the page header opens `/join/<slug>` in a new tab.
- Photo upload deferred (Q2=D); follow-up brief will land it across Settings + Portfolio together.
- **No schema migration.** Reuses existing `position` columns and existing `is_public_sample` boolean.

Design doc: `docs/plans/active/2026-05-17-portfolio-redesign-design.md`
Plan: `docs/plans/active/2026-05-17-portfolio-redesign-tasks.md`

## Test plan
- [ ] /skitza-verify clean (typecheck, lint, tests)
- [ ] Portfolio page loads on preview deploy
- [ ] Paste a Spotify link → row appears with detected platform
- [ ] Paste a Vimeo link → inline "we don't recognise that platform yet"
- [ ] Click ▲ on row 2 → row 2 moves up, ▲ on first row is disabled
- [ ] Add 5 tracks → "Add from music library" button disables
- [ ] "View public page ↗" opens `/join/<slug>` in a new tab
- [ ] `/join/<your-slug>` page renders unchanged — public consumer not regressed
EOF
)"
```

**Step 3 — Verify the PR's Vercel preview status:**

Read the Vercel bot comment on the PR for "Ready" status. Do NOT curl the preview URL (per memory, it's SSO-gated and returns 401).

---

## Notes for the executor (me)

- **Skitza CSS tokens that DO NOT exist:** `--surface-card`, `--text-muted`, `--text-strong`, `--surface-hover`, `--brand-primary-on`. Using them = transparent backgrounds + invisible text. Real ones: `--bg-base`, `--bg-elevated`, `--bg-sunken`, `--bg-overlay`, `--fg-primary`, `--fg-secondary`, `--fg-muted`, `--fg-inverse`, `--fg-default`, `--brand-primary`, `--border-subtle`, `--border-strong`, `--radius-sm`, `--radius-md`, `--radius-lg`.
- **Rectangle radius:** every text rectangle uses `rounded-[var(--radius-lg)]` (16px). `rounded-full` is for actual squares (avatars, icon-only buttons, dots, play buttons).
- **Producer dashboard is desktop only.** Do not add mobile breakpoints. The grid is `grid-cols-[minmax(0,38fr)_minmax(0,62fr)]` flat, no `sm:` / `md:` prefixes.
- **v3-clean push needs PR.** `gh pr create --base v3-clean`.
- **Vercel preview is SSO-gated.** Read the bot's status, don't curl HTML.
- **Parallel sessions flip branches.** Always `cd /Users/giliasraf/skitza-portfolio-redesign` at the start of every bash, and chain related ops in one `&&` chain.

---

**End of plan.**
