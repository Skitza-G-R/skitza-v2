# Story 04 — Project Dashboard tab UI (5 modules + meta sidebar)

**Epic:** Project Room redesign 2026-04-26
**Architecture ref:** [`docs/plans/active/2026-04-26-project-room-redesign-architecture.md` § 5.1 New components / Dashboard tab](../active/2026-04-26-project-room-redesign-architecture.md)
**PRD anchor:** [§11.5 Project Dashboard tab](../../product/PRD.md)
**Depends on:** S02 (`projectRoom.dashboard` query), S03 (sub-tab plumbing — Dashboard slot exists)
**Blocks:** none — terminal Dashboard story
**Subagent:** `skitza-tdd-implementer` + `skitza-ux-critic` for UI review

## Goal

Build the new default sub-tab — a read-mostly project-status surface — replacing the prior Notes tab. Layout follows Linear/Frame.io: focal column + meta sidebar (chip strip on mobile). 5 modules in the focal column, 5 fields in the meta sidebar.

## User story

As a producer (or artist), when I open a project, the **first thing I see** is a clear, scannable summary of where the project stands — what was last sent, what's awaiting review, when the next session is, what the artist owes — without having to click into Music or Money to figure it out.

## Acceptance criteria

### Component tree
- [ ] [`apps/web/src/components/dashboard/project/sub-tabs/dashboard-sub-tab.tsx`](../../apps/web/src/components/dashboard/project/sub-tabs/dashboard-sub-tab.tsx) — top-level layout, runs `trpc.projectRoom.dashboard.useQuery({ projectId })`.
- [ ] 5 module components in [`apps/web/src/components/dashboard/project/dashboard/`](../../apps/web/src/components/dashboard/project/dashboard/):
  - `header-strip.tsx` — artist name + project title + stage chip + ONE morphing primary CTA
  - `latest-version-strip.tsx` — embedded waveform + play button (reuses [`PersistentPlayer`](../../apps/web/src/components/audio/persistent-player.tsx))
  - `whats-next.tsx` — one-line next-action signal
  - `recent-activity-feed.tsx` — Linear-style collapsed history (last 5 events + "Show earlier")
  - `open-comments-list.tsx` — top 2-3 unresolved comment threads, click jumps to Music tab at the comment timestamp
- [ ] `meta-sidebar.tsx` — right rail (desktop ≥1024px) / chip strip (mobile)
- [ ] Mobile pattern: meta sidebar collapses to a single chip strip under the header. Focal column is full-bleed.

### Behavior
- [ ] **Header strip CTA morphs by stage** per PRD §11.5:
  - `lead` → "Approve & invoice deposit"
  - `trial` → "Send V1 for review"
  - `in_progress` → "Send next version"
  - `final` → "Mark final & invoice"
  - `paid` → "Archive"
- [ ] **What's next** uses precedence (first-true-wins):
  1. Contract not yet signed → "Send contract for signature"
  2. Unpaid invoice past due → "Invoice #N · X days overdue"
  3. Session within next 48h → "Session <day> <time> · confirmed/pending"
  4. Unread artist comment → "<N> new comment(s) from <artist>"
  5. Latest version awaiting review → "Awaiting artist feedback on V<N> (sent <relative>)"
  6. Otherwise → component returns null (entire module hides)
- [ ] **Latest version strip** click on title → `router.push(\`/dashboard/projects/${projectId}?tab=music&versionId=${versionId}\`)`. Uses existing `PersistentPlayer` for audio playback (no new audio infra).
- [ ] **Recent activity** uses Linear-style collapsed-history: shows 5 most recent events; "Show earlier" expands to full log. Event types covered: `track_version_uploaded`, `comment_posted`, `comment_resolved`, `session_booked`, `session_confirmed`, `session_cancelled`, `invoice_sent`, `invoice_paid`, `invoice_refunded`, `contract_signed`, `stage_forward`.
- [ ] **Open comments** shows up to 3. Each renders: track title · timestamp anchor (mm:ss format) · comment preview (first 80 chars) · reply count. Click → `router.push(\`/dashboard/projects/${projectId}?tab=music&versionId=...&commentId=...\`)`.
- [ ] Empty states are explicit:
  - Zero versions → Latest version module hides (silence > "no tracks yet").
  - Zero events → Recent activity module shows a single placeholder line "Project just started — events will appear here as you work."
  - Zero open comments → Open comments module hides.

### Layout & responsive
- [ ] **Desktop ≥1024px**: focal column (left, ~7/12 grid) + meta sidebar (right, ~5/12 grid, sticky-top within the panel).
- [ ] **Tablet 768-1023px**: focal column full-bleed, meta sidebar drops below as a 2-column grid of fields.
- [ ] **Mobile <768px**: focal column full-bleed, meta sidebar collapses to a single horizontal chip strip under the header (3-4 chips: `Money $X · Next: Sat · Files 12 · → Music`).
- [ ] Touch targets ≥ 44×44 on mobile (use `.sk-tap` utility from CLAUDE.md UI conventions).
- [ ] iOS safe-area respected (`.sk-safe-top`, `.sk-safe-bottom`).

### Styling
- [ ] CSS variables only — NO hex codes or `bg-blue-500`-style Tailwind colors. Use `bg-[rgb(var(--bg-elevated))]`, `text-[rgb(var(--fg-primary))]`, etc., per CLAUDE.md UI conventions.
- [ ] Animation primitives respect `prefers-reduced-motion` (the existing motion-primitives test in [`apps/web/src/app/__tests__/motion-primitives.test.ts`](../../apps/web/src/app/__tests__/motion-primitives.test.ts) MUST keep passing — any new primitives need a `@media (prefers-reduced-motion: reduce)` gate).
- [ ] Editorial typography for the project title (matches the existing dashboard typography — see [`apps/web/src/app/globals.css`](../../apps/web/src/app/globals.css) for the title scale).
- [ ] `:focus-visible` (NOT `:focus`) for keyboard focus rings.

### Tests
- [ ] `dashboard-sub-tab.test.tsx` — renders all 5 modules + meta sidebar with stub data.
- [ ] `header-strip.test.tsx` — CTA copy matches stage; click fires the right action (mock the action).
- [ ] `whats-next.test.tsx` — precedence ladder. Five fixtures, one per priority, assert the correct line renders. Sixth fixture with all-clear assert renders `null`.
- [ ] `recent-activity-feed.test.tsx` — 5 visible by default; "Show earlier" expands to all events; collapsed-history visual matches Linear pattern.
- [ ] `open-comments-list.test.tsx` — empty state hides component; populated state shows 3 with click-to-jump URLs correct.
- [ ] `meta-sidebar.test.tsx` — desktop renders right rail; mobile renders chip strip (use `matchMedia` mock or jsdom viewport).
- [ ] `/skitza-verify` passes.
- [ ] `skitza-ux-critic` subagent reviews for Samply/Spotify-quality polish (per CLAUDE.md UX bar). Loop until clean.

## Technical context

### Data flow

```tsx
// apps/web/src/components/dashboard/project/sub-tabs/dashboard-sub-tab.tsx
export function DashboardSubTab({ projectId }: { projectId: string }) {
  const { data, isLoading } = trpc.projectRoom.dashboard.useQuery(
    { projectId },
    { staleTime: 30_000 },
  );
  if (isLoading) return <DashboardSkeleton />;
  if (!data) return null;
  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
      <div className="lg:col-span-7 flex flex-col gap-4">
        <HeaderStrip {...data.header} />
        <LatestVersionStrip latestVersion={data.latestVersion} projectId={projectId} />
        <WhatsNext signal={data.whatsNext} />
        <RecentActivityFeed events={data.recentActivity} />
        <OpenCommentsList comments={data.openComments} projectId={projectId} />
      </div>
      <aside className="lg:col-span-5 lg:sticky lg:top-4">
        <MetaSidebar sidebar={data.sidebar} />
      </aside>
    </div>
  );
}
```

### Reuse — don't reinvent

- **Audio playback**: existing [`PersistentPlayer`](../../apps/web/src/components/audio/persistent-player.tsx) infra. The Latest Version Strip embeds a small waveform + play button that hands off to the persistent player on play.
- **Stage chip**: existing component used in the Today inbox + Projects list (grep `stage` in [`apps/web/src/components/`](../../apps/web/src/components/)). Reuse, don't fork.
- **Relative time**: existing [`apps/web/src/lib/time/relative.ts`](../../apps/web/src/lib/time/relative.ts) — `formatRelativeTime(date)`.
- **Money formatting**: existing currency formatter (grep — likely in `apps/web/src/lib/`). Producer's `defaultCurrency` already on the dashboard payload.

### Benchmark references

PRD §11.5 cites Linear's issue page and Frame.io's project landing as the layout inspirations. The `skitza-ux-critic` subagent uses Samply / Spotify for Artists / Notion as the polish benchmarks (per `.claude/agents/skitza-ux-critic.md`).

## TDD steps

1. **RED** — `dashboard-sub-tab.test.tsx`: render with stub data, assert all 5 modules + meta sidebar are present. Run — fails (component missing).
2. **GREEN** — scaffold `dashboard-sub-tab.tsx` + the 5 module placeholders + meta sidebar. Test passes.
3. **RED + GREEN per module** — write a test per module, then implement.
4. **RED + GREEN — empty states.** Each empty fixture asserts the right collapse behavior.
5. **RED + GREEN — responsive layouts.** Use `matchMedia` mock to assert mobile chip strip vs desktop sidebar render.
6. **Manual** — start `pnpm dev`, open a project, walk through every state. Resize the browser to 360px / 768px / 1280px. Verify touch targets, safe-area, scrolling.
7. **Subagent loop** — dispatch `skitza-ux-critic` against the rendered Dashboard tab. Iterate on feedback.
8. `/skitza-verify` passes.

## Test file paths

- `apps/web/src/components/dashboard/project/sub-tabs/__tests__/dashboard-sub-tab.test.tsx`
- `apps/web/src/components/dashboard/project/dashboard/__tests__/header-strip.test.tsx`
- `apps/web/src/components/dashboard/project/dashboard/__tests__/whats-next.test.tsx`
- `apps/web/src/components/dashboard/project/dashboard/__tests__/recent-activity-feed.test.tsx`
- `apps/web/src/components/dashboard/project/dashboard/__tests__/open-comments-list.test.tsx`
- `apps/web/src/components/dashboard/project/dashboard/__tests__/meta-sidebar.test.tsx`

## Definition of done

- [ ] Dashboard tab renders all 5 modules + meta sidebar at all 3 breakpoints
- [ ] All empty states correct (silent vs placeholder per spec)
- [ ] Audio strip plays via PersistentPlayer
- [ ] `skitza-ux-critic` review clean (Samply-tier polish)
- [ ] `/skitza-verify` passes

## Commit message

```
feat(project-room): Dashboard tab — 5 modules + meta sidebar

Implements PRD §11.5 — the new default sub-tab on opening any project.
Replaces the prior Notes tab as a read-mostly project-status surface.

Layout: focal column (header strip + latest version playback + what's
next + recent activity + open comments) + meta sidebar (stage CTA +
money summary + next session + files + artist contact). Inspired by
Linear's issue page + Frame.io's project landing — tight focal column,
always-visible meta. Mobile collapses meta to a chip strip under the
header.

Header CTA morphs by stage: lead → "Approve & invoice deposit", trial
→ "Send V1 for review", in_progress → "Send next version", final →
"Mark final & invoice", paid → "Archive". One control, contextual.

What's next derives a single line from project state with strict
precedence (first-true-wins): contract-not-signed → unpaid-invoice-past-
due → session-within-48h → unread-artist-comment → version-awaiting-
review. All clear → component hides.

Reuses existing PersistentPlayer for audio playback, formatRelativeTime
for "sent 2 days ago" labels, and the existing stage chip + currency
formatter components — no new audio or formatting infra.

Story 04 of the project-room-redesign epic. Depends on S02 (dashboard
tRPC query) and S03 (sub-tab plumbing). Reviewed by skitza-ux-critic
for Samply/Spotify-tier polish (audit-trail in PR comments).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```
