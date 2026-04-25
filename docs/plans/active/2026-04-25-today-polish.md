# Today dashboard polish — 2026-04-25

**Track:** Standard BMAD
**PRD delta:** §4.1 (committed separately, ahead of code)
**Goal:** raise the visual coherence of the Today dashboard so it reads as one designed surface, not a stack of components, while resolving the URL-block / QuickActions redundancy and the sidebar shortcut overlap.

## Product calls (locked by Analyst phase)

1. **Redundancy resolution = option (c)** — Copy + Preview live exclusively in the ShareLinkCard header. The two QuickActions slots they used to occupy get repurposed.
2. **Two-tier action grid is intentional** — primary cards = creation/share; secondary pills = utilities. Don't flatten.
3. **Empty chart = quiet professional** — three faint Y-axis grid lines + the existing dashed zero baseline. No onboarding CTA.

## File-by-file changes

### `apps/web/src/components/dashboard/today/share-link-card.tsx`

- **URL chip:** drop `gap-2`, merge `skitza.app` + `/join/` into one muted span, slug stays in a bolded sibling span. Reads as `skitza.app/join/<slug>` with no internal whitespace.
- Bolded slug uses `font-semibold` + `text-[rgb(var(--fg-primary))]` (already there); muted prefix is `text-[rgb(var(--fg-muted))]`.
- `aria-label` on the wrapping div mirrors the full URL so screen readers don't read it as two disjoint phrases.

### `apps/web/src/components/dashboard/today/quick-actions.tsx`

- **Remove** the `PrimaryButton` for `copyShareLink` (slot 1 of primary row).
- **Remove** the `Chip` for `previewPublic` (slot 4 of secondary row).
- **Add** `PrimaryButton` for `shareViaWhatsApp` — opens `https://wa.me/?text=<encoded share text>` in a new tab. Disabled when `shareUrl` is null.
- **Add** `Chip` for `editJoinPage` — `href="/dashboard/settings?section=profile"`.
- **PrimaryButton internals:** keep `min-h-[84px]`, but tighten internal layout — anchor label + description to `align-items: flex-start` with `gap-1.5` (no change), but reduce padding asymmetry (`p-4 ps-5` already present) is fine. The visual fix is dropping the ghost-card affordance: keep border + elevated bg + brand inset shadow on hover. No new design tokens.
- **Chip internals:** unify `min-h-11` so all four pills land at the same height as the primary buttons' tap target floor on mobile (44×44 already enforced via `sk-tap`). Add `justify-center` on desktop so labels align center across all four pills (currently only applied at `sm:`).
- **Disabled state copy:** the new "Share via WhatsApp" mirrors "Copy share link" — when no slug, hint = "Set your slug first".

### `apps/web/src/components/dashboard/today/revenue-trend.tsx`

- Add three horizontal grid lines at `0.25 * plotH`, `0.5 * plotH`, `0.75 * plotH` from the top of the plot region, drawn as `stroke="rgb(var(--border-subtle))"` with `stroke-opacity="0.4"` (low enough that they don't compete with the line stroke when there's real data, high enough that they read as "this is a chart" when the data is all zeros).
- Render the grid lines as siblings of the existing dashed baseline, BEFORE the `areaPath` and `linePath` so they sit underneath. SVG paint order = source order.
- No JS changes — the lines are static at the same Y positions regardless of data.
- A11y: grid lines are decorative; existing `aria-label` on the `<svg role="img">` already describes the chart's content.

### `apps/web/src/components/dashboard/today/kpi-strip.tsx`

- Switch from `gap-x-6` + `divide-x` to `divide-x` only (no horizontal gap) — `divide-x` already adds the visible 1px hairline; the gap was creating a detached look where the divider didn't reach the column edges.
- Maintain vertical `gap-y-6` for the mobile 2-col fallback (the divider isn't applied at < `sm:`).
- Inside each `<Kpi>` cell: add `flex flex-col justify-end` so the value sits at the bottom of the cell when label heights vary across columns; this prevents the "uneven vertical alignment" the user flagged.

### `apps/web/src/components/shell/sidebar.tsx`

- **Drop the `KeyboardHint` wrapper** around `<Link>` in `SidebarItem`. Replace with an inline `<kbd>` chip rendered to the trailing edge of the row.
- The inline chip is rendered only when:
  - sidebar is expanded (`!collapsed`)
  - row is **not** active (active state has the brand bar)
  - row has **no unread badge** (badge takes precedence)
- Visibility: `opacity-0 group-hover:opacity-100 group-focus-within:opacity-100` — quiet by default, surfaces on hover/keyboard focus.
- Add `group` to the `<Link>` className so children can target `group-hover`.
- Use the existing `tokenizeShortcut` helper from `keyboard-hint.tsx` so the rendering logic stays consistent.
- This kills the portal collision entirely — no `getBoundingClientRect` math, no overlap with adjacent rows.

### `apps/web/messages/en.json` + `he.json`

- Add `today.quickActions.shareViaWhatsApp` + `shareViaWhatsAppHint` + `shareViaWhatsAppHintEmpty`.
- Add `today.quickActions.editJoinPage`.
- Remove `copyShareLink` + `copyShareLinkHint` + `previewPublic` (no longer rendered — keep them out so future drift is impossible).

### Tests

- `apps/web/src/components/shell/__tests__/sidebar.test.tsx` — existing test only checks `NAV_ITEMS` data, no DOM, no change needed.
- New: `apps/web/src/components/dashboard/today/__tests__/quick-actions-pills.test.ts` — pin the four primary-card labels and four pill labels by reading the QuickActions source. Source-grep is the right granularity here — full DOM rendering would require mocking `useTranslations`, `useToast`, server actions, etc., for what is fundamentally a "did the labels we agreed on actually ship?" check.
- The pills test also asserts that `copyShareLink` and `previewPublic` keys are NOT referenced in QuickActions source (preventing regression).

## Verify gate

```
pnpm -F web typecheck && pnpm -F web lint && pnpm -F web test
```

All three must pass before commit.

## Commit shape

1. `docs(prd): §4.1 Today polish — pill swap, URL chip, sidebar shortcuts inline` (already done above before code lands)
2. `feat(today): swap Copy/Preview duplicates for WhatsApp + Edit pills`
3. `feat(today): tighten URL chip, KPI dividers, chart Y guides`
4. `refactor(sidebar): inline shortcut chips, retire portal tooltip on nav`

Or one bundled commit if scope feels small enough on review — TBD post-implementation.

## Out of scope (future work)

- Action-card icons (would be a Standard track of its own).
- Real revenue when no invoices exist (the chart already returns null when `points.length === 0`; the grid-line work is for the all-zeros, has-data case).
- KPI strip animated countup (deferred to motion polish epic).
- Sidebar collapsed-state shortcut surfacing (collapsed sidebar shows icon-only, the cheatsheet `?` covers it).
