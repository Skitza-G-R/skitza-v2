# Story 05 — `SidebarShareChip` in sidebar footer (every page)

**Epic:** Today redesign 2026-04-25
**Depends on:** none.
**Blocks:** Story 06 (page rebuild — removes ShareLinkCard from Today).
**Subagent:** `skitza-tdd-implementer`

## Goal

Move the share-link surface from a Today hero into the **sidebar footer** so it's always reachable from every authenticated page. Replace the current "Public profile →" link in [`sidebar.tsx`](../../apps/web/src/components/shell/sidebar.tsx) with a compact inline share chip that copies on click.

## User story

As a producer, I want my share link reachable from any page (not just Today), without it dominating the visual real estate of my daily dashboard.

## Acceptance criteria

- [ ] New file `apps/web/src/components/shell/sidebar-share-chip.tsx`.
- [ ] Replace the existing `Public profile →` link in `sidebar.tsx` (around line 199-209) with `<SidebarShareChip producerSlug={producerSlug} collapsed={collapsed} publicBaseUrl={...} />`.
- [ ] When `producerSlug !== null` AND `collapsed === false`:
  - Render a compact pill: `skitza.app/join/<slug>` (single-line, truncated if needed) + small inline 📋 copy button on the trailing edge.
  - Click anywhere on the pill (except the copy button): opens the `/join/<slug>` URL in a new tab (matches existing Preview action).
  - Click the copy button: copies the full URL to clipboard via `navigator.clipboard.writeText`. Fires a toast on success/failure.
- [ ] When `producerSlug === null` AND `collapsed === false`:
  - Render a "Set your slug →" link to `/dashboard/settings?section=profile`. Same affordance as the existing missing-slug ShareLinkCard fallback.
- [ ] When `collapsed === true` (sidebar collapsed):
  - With slug: render an icon-only 📋 button. Click copies. `title` attribute = the URL for the native hover tooltip.
  - Without slug: render an icon-only ⚙ gear linking to settings.
- [ ] No new design tokens.
- [ ] Existing sidebar tests in [`sidebar.test.tsx`](../../apps/web/src/components/shell/__tests__/sidebar.test.tsx) still pass.
- [ ] New test `sidebar-share-chip.test.tsx` covers: copy-on-click, missing-slug fallback, collapsed-state icon-only.

## Technical context

### File to create

- `apps/web/src/components/shell/sidebar-share-chip.tsx`
- `apps/web/src/components/shell/__tests__/sidebar-share-chip.test.tsx`

### File to edit

- `apps/web/src/components/shell/sidebar.tsx` — replace the existing `Public profile →` block (around lines 200-209) with the new chip. Pass `publicBaseUrl` from the Sidebar's parent (already available via the `appShell` server data) — add the prop to `Sidebar` if it isn't there.

### Props

```ts
interface SidebarShareChipProps {
  producerSlug: string | null;
  collapsed: boolean;
  publicBaseUrl: string;  // e.g. "https://skitza.app"
}
```

### Render — expanded + slug present

```tsx
<div className="mx-2 mb-2 flex items-center gap-1 rounded-md border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-sunken))] px-2 py-1.5">
  <a
    href={fullUrl}
    target="_blank"
    rel="noreferrer"
    className="min-w-0 flex-1 truncate font-mono text-[0.7rem] text-[rgb(var(--fg-secondary))] hover:text-[rgb(var(--brand-primary))]"
    title={fullUrl}
  >
    skitza.app/join/<span className="font-semibold text-[rgb(var(--fg-primary))]">{producerSlug}</span>
  </a>
  <button
    type="button"
    onClick={copy}
    aria-label="Copy share link"
    className="shrink-0 rounded p-1 text-[rgb(var(--fg-muted))] hover:bg-[rgb(var(--bg-overlay))] hover:text-[rgb(var(--brand-primary))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))]"
  >
    <CopyIcon />
  </button>
</div>
```

### Render — expanded + no slug

```tsx
<a
  href="/dashboard/settings?section=profile"
  className="mx-2 mb-2 flex items-center justify-center rounded-md border border-dashed border-[rgb(var(--border-subtle))] px-2 py-1.5 font-mono text-[0.7rem] text-[rgb(var(--fg-muted))] hover:border-[rgb(var(--brand-primary)/0.4)] hover:text-[rgb(var(--brand-primary))]"
>
  Set your slug →
</a>
```

### Render — collapsed + slug present

```tsx
<button
  type="button"
  onClick={copy}
  aria-label="Copy share link"
  title={fullUrl}
  className="mx-auto mb-2 flex h-8 w-8 items-center justify-center rounded-md text-[rgb(var(--fg-muted))] hover:bg-[rgb(var(--bg-overlay))] hover:text-[rgb(var(--brand-primary))]"
>
  <CopyIcon />
</button>
```

### Copy logic

```ts
function copy() {
  if (!producerSlug) return;
  void navigator.clipboard.writeText(fullUrl)
    .then(() => toast("Copied", "success"))
    .catch(() => toast("Couldn't copy", "error"));
}
```

Reuse the `useToast()` hook + the existing translation keys (`today.toasts.copied`, `today.toasts.couldNotCopy`).

### `CopyIcon`

Inline SVG, 14×14, two-rectangle clipboard icon. Same drawing convention as the icons in `sidebar.tsx`.

## TDD steps

1. **RED** — `sidebar-share-chip.test.tsx`. Assert: with slug → renders chip with text `skitza.app/join/<slug>` and a copy button. Click copy → fires `navigator.clipboard.writeText` (mock).
2. **GREEN** — implement chip + collapsed/expanded variants.
3. **RED** — missing-slug case → renders "Set your slug →" link with correct href.
4. **GREEN** — verify.
5. **RED** — collapsed case → icon-only button with `title` attribute.
6. **GREEN** — verify.
7. Update `sidebar.tsx` to call `SidebarShareChip` instead of the existing `Public profile →` block. Run existing sidebar test — should still pass.
8. `/skitza-verify`.

## Commit message

```
feat(shell): SidebarShareChip — share link in sidebar footer, every page

Moves the share-link surface from a Today hero into the sidebar
footer so it's reachable from every authenticated page (not just
the dashboard landing). Frees the Today hero for actual cockpit
content (Story 06).

Expanded chip: skitza.app/join/<slug> with bold slug + inline copy
button. Click chip body opens preview in new tab; click copy button
copies to clipboard with toast feedback.

Missing-slug fallback: "Set your slug →" dashed-border CTA linking
to Setup → Profile. Same affordance as the existing missing-slug
ShareLinkCard, just relocated.

Collapsed sidebar: icon-only 📋 copy button (or ⚙ gear if no slug),
title attribute = URL for native hover tooltip.

Story 05 of the today-redesign epic. ShareLinkCard removal from
Today happens in Story 06.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```
