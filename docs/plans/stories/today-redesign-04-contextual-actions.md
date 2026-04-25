# Story 04 — `ContextualActions` component (3 dynamic cards, replaces 8-button QuickActions)

**Epic:** Today redesign 2026-04-25
**Depends on:** Story 01 (data shape).
**Blocks:** Story 06 (page rebuild).
**Subagent:** `skitza-tdd-implementer`

## Goal

A 3-card row of context-aware actions that change based on the producer's current state, replacing the 8-button QuickActions strip from PR #47. Always renders exactly 3 cards (priority-padded with fallbacks if fewer than 3 conditions match).

## User story

As a producer, when I open Today, I want to see the *next 1–3 things I should probably do* — derived from my actual state (unread comments, recent uploads, projects in final review) — not a menu of 8 generic buttons.

## Acceptance criteria

- [ ] New file `apps/web/src/components/dashboard/today/contextual-actions.tsx`.
- [ ] Renders exactly 3 cards (always 3, never less, never more).
- [ ] Algorithm picks cards in priority order:
  1. **"Reply to N unresolved"** — fires when `unresolvedItems > 0`. Navigates to `/dashboard?filter=unresolved`. Card subtitle: `"N comments + invoices waiting"` (the count is the actual `unresolvedItems` value).
  2. **"Continue with [most-recent-track]"** — fires when `recentUploads.length > 0`. Uses `recentUploads[0].title`. Subtitle: `"In [client name]'s project"`. Navigates to `/dashboard/projects/${recentUploads[0].projectId}?tab=music`.
  3. **"Send next invoice"** — fires when `activeProjectsCount > 0`. Subtitle: `"Bill the work you've done"`. Navigates to `/dashboard/projects` with a future filter for `final_review` (for v1 just route to `/dashboard/projects`; the filter UX is post-redesign work).
  4. **"Share your link"** (fallback when none of 1–3 match and `shareUrl !== null`) — opens wa.me share dialog. Subtitle: `"Get your first booking"`. Same wa.me logic that shipped in PR #47.
  5. **"Start a new project"** (final fallback) — `/dashboard/projects/new`. Subtitle: `"Start tracking work"`.
- [ ] Algorithm pads with later-priority cards when earlier ones don't fire — e.g. a producer with 0 unresolved + 3 uploads + 2 active projects gets cards 2, 3, and 4.
- [ ] Card style matches the polished `PrimaryButton` from PR #47: border + bg-elevated + brand-primary inset bar on hover (`sk-lift` + `hover:shadow-[inset_3px_0_0_rgb(var(--brand-primary))]`).
- [ ] No new design tokens.
- [ ] Component test covers all 5 priority conditions + the priority-padding logic.

## Technical context

### Files to create

- `apps/web/src/components/dashboard/today/contextual-actions.tsx`
- `apps/web/src/components/dashboard/today/__tests__/contextual-actions.test.tsx`

### Props

```ts
interface ContextualActionsProps {
  unresolvedItems: number
  recentUploads: RecentUpload[]
  activeProjectsCount: number
  shareUrl: string | null
}
```

### Algorithm

```ts
function pickActions({ unresolvedItems, recentUploads, activeProjectsCount, shareUrl }: ContextualActionsProps) {
  const candidates: ActionCard[] = [];

  // Priority 1: Reply to unresolved
  if (unresolvedItems > 0) {
    candidates.push({
      id: "reply-unresolved",
      label: `Reply to ${unresolvedItems}`,
      description: unresolvedItems === 1 ? "1 unresolved item" : `${unresolvedItems} unresolved items`,
      href: "/dashboard?filter=unresolved",
    });
  }

  // Priority 2: Continue with recent track
  if (recentUploads.length > 0) {
    const top = recentUploads[0]!;
    candidates.push({
      id: "continue-track",
      label: `Continue with ${top.title}`,
      description: `In ${top.projectClientName}'s project`,
      href: `/dashboard/projects/${top.projectId}?tab=music`,
    });
  }

  // Priority 3: Send next invoice
  if (activeProjectsCount > 0) {
    candidates.push({
      id: "send-invoice",
      label: "Send next invoice",
      description: "Bill the work you've done",
      href: "/dashboard/projects",
    });
  }

  // Priority 4: Share your link (fallback)
  if (shareUrl) {
    candidates.push({
      id: "share-link",
      label: "Share your link",
      description: "Get your next booking",
      onClick: () => {
        const text = `Check out my studio: ${shareUrl}`;
        window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank", "noopener,noreferrer");
      },
    });
  }

  // Priority 5: Start a new project (final fallback)
  candidates.push({
    id: "new-project",
    label: "Start a new project",
    description: "Track new work",
    href: "/dashboard/projects/new",
  });

  // Pad/truncate to exactly 3.
  return candidates.slice(0, 3);
}
```

### Card render

```tsx
function ActionCard({ action }: { action: ActionCard }) {
  const classes = "sk-lift flex min-h-[84px] flex-col items-start justify-center gap-1.5 rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-4 ps-5 text-start transition-all hover:border-[rgb(var(--brand-primary)/0.4)] hover:shadow-[inset_3px_0_0_rgb(var(--brand-primary))] rtl:hover:shadow-[inset_-3px_0_0_rgb(var(--brand-primary))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))]";

  const content = (
    <>
      <span className="text-[0.95rem] font-semibold text-[rgb(var(--fg-primary))]">{action.label}</span>
      <span className="text-xs text-[rgb(var(--fg-secondary))]">{action.description}</span>
    </>
  );

  if (action.href) {
    return <a href={action.href} className={classes}>{content}</a>;
  }
  return <button type="button" onClick={action.onClick} className={classes}>{content}</button>;
}
```

### Section layout

```tsx
<section aria-label="Contextual actions" className="mb-6">
  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
    {actions.map((a) => <ActionCard key={a.id} action={a} />)}
  </div>
</section>
```

### Test fixtures

```ts
const fixtures = [
  {
    name: "zero state — only fallbacks fire",
    input: { unresolvedItems: 0, recentUploads: [], activeProjectsCount: 0, shareUrl: "https://..." },
    expectedIds: ["share-link", "new-project", /* padding fails — need 3 — see below */],
  },
  // … etc
];
```

**Edge case:** the algorithm has 5 candidates max but always needs 3. With `shareUrl === null`, only 4 candidates exist; with all-zero state and no shareUrl, only 1 candidate (new-project). Padding logic: when fewer than 3, REPEAT no — instead, append additional fallback variations: "Add offline client" → `/dashboard/projects/new` with `?mode=offline` query.

Adjust algorithm to include a 6th deterministic fallback (`add-offline-client`) so day-1 producers always get 3 distinct cards.

## TDD steps

1. **RED** — `contextual-actions.test.tsx` — 5 fixture states (full / unresolved-only / upload-only / final-review-only / day-1). Assert: exactly 3 cards rendered, in priority order, with correct labels + hrefs.
2. **GREEN** — implement `pickActions` + `ActionCard` + section render.
3. **RED** — assert that `unresolvedItems === 1` produces "1 unresolved item" (singular) not "1 unresolved items".
4. **GREEN** — singular/plural handling.
5. **RED** — assert wa.me URL encoding for share-link click.
6. **GREEN** — verify encodeURIComponent.
7. `/skitza-verify`.

## Commit message

```
feat(today): ContextualActions — 3 dynamic cards replacing the 8-button strip

Replaces the QuickActions strip (8 buttons in 2 rows) with 3 priority-
picked context-aware cards. The producer sees 1–3 things they should
probably do next, derived from current state — not a menu.

Priority algorithm (top-3 win):
  1. Reply to N unresolved (unresolvedItems > 0)
  2. Continue with [most-recent-track] (recentUploads.length > 0)
  3. Send next invoice (activeProjectsCount > 0)
  4. Share your link via wa.me (fallback when shareUrl exists)
  5. Add offline client (fallback)
  6. Start a new project (final fallback)

Algorithm always returns 3 cards, padding with later-priority entries
when earlier conditions don't match. Day-1 producer with no data gets
share-link + offline-client + new-project.

Card style reuses the PrimaryButton primitive from PR #47 (border +
bg-elevated + brand inset bar on hover).

Story 04 of the today-redesign epic. Component is integrated into
the Today page in Story 06.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```
