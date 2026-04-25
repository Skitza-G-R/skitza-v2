# Story 03 — `RecentUploadsShelf` component (with `TrackCover`)

**Epic:** Today redesign 2026-04-25
**Depends on:** Story 01 (`recentUploads` payload).
**Blocks:** Story 06 (page rebuild).
**Subagent:** `skitza-tdd-implementer`

## Goal

A horizontal shelf of cover-art cards showing the producer's last 5–7 track-version uploads across active projects. Click cover → deep-link to project room. Hover → play overlay surfaces; click play → existing PersistentPlayer takes over via custom event. Unread-comment badge surfaces when artists have replied since upload.

## User story

As a producer, when I open Today, I want to see what I last uploaded (cover, title, version, project, time) so I can quickly check what just landed and listen back without navigating.

## Acceptance criteria

- [ ] New file `apps/web/src/components/dashboard/today/recent-uploads-shelf.tsx`.
- [ ] New file `apps/web/src/components/dashboard/today/recent-upload-card.tsx` (sub-component).
- [ ] New file `apps/web/src/components/audio/track-cover.tsx` — deterministic gradient cover from `trackId` hash.
- [ ] Layout: section with eyebrow `STUDIO · RECENT UPLOADS`, heading `Recent uploads`, then horizontal row of cards.
- [ ] Card structure: 144×144 cover (deterministic gradient), title (e.g. "Sunset Mix") + version label (e.g. "v3") below, project client name + relative time as a small subtitle.
- [ ] Hover on cover: play-button icon overlay fades up at 80% opacity over the gradient.
- [ ] Click play overlay: dispatches `window.dispatchEvent(new CustomEvent('skitza:play-version', { detail: { versionId, audioUrl, durationMs } }))`. **No new audio code in this component.**
- [ ] Click anywhere else on the card: navigates to `/dashboard/projects/${projectId}?tab=music&versionId=${versionId}`.
- [ ] Unread-comment badge: top-right corner of the cover, brand-primary fill, white digit, only when `unreadComments > 0`. Cap at `99+` for sanity.
- [ ] Empty state: `uploads.length === 0` → component returns `null`. No "no tracks yet" copy.
- [ ] Sparse state: 1–4 uploads → render left-aligned, no scroll affordance.
- [ ] Full state: 5+ uploads → first 5 visible, rest scroll-x via `sk-scroll-x`, trailing card is a "View all in Music →" link to `/dashboard/music`.
- [ ] Mobile: horizontal scroll via `sk-scroll-x` (already in globals.css).
- [ ] No new design tokens. No new dependencies.
- [ ] Component test covers: 0/1/4/7 uploads, badge presence, custom event firing on play click, deep-link href correctness.

## Technical context

### `TrackCover` — deterministic gradient

```tsx
// apps/web/src/components/audio/track-cover.tsx
"use client";

const PALETTE = [
  ["#E8845C", "#A14E3A"],  // copper → rust
  ["#5C8FE8", "#3A4FA1"],  // sky → indigo
  ["#5CE89A", "#3AA17F"],  // mint → forest
  ["#E85CD9", "#A13A8E"],  // pink → magenta
  ["#E8C95C", "#A18E3A"],  // gold → ochre
  ["#5CE8E0", "#3AA199"],  // cyan → teal
  ["#B25CE8", "#7A3AA1"],  // violet → purple
  ["#E85C5C", "#A13A3A"],  // red → crimson
  ["#5CE85C", "#3AA13A"],  // lime → emerald
  ["#5C73E8", "#3A4DA1"],  // royal → cobalt
  ["#E8A35C", "#A1773A"],  // amber → bronze
  ["#8AE85C", "#67A13A"],  // chartreuse → moss
];

function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export function TrackCover({ trackId, size = 144, className = "" }: {
  trackId: string;
  size?: number;
  className?: string;
}) {
  const h = hashStr(trackId);
  const colors = PALETTE[h % PALETTE.length] ?? PALETTE[0]!;
  const angle = (h % 360);
  return (
    <div
      role="img"
      aria-hidden
      className={`relative shrink-0 rounded-[var(--radius-md)] ${className}`}
      style={{
        width: size,
        height: size,
        background: `linear-gradient(${angle}deg, ${colors[0]}, ${colors[1]})`,
      }}
    />
  );
}
```

This component renders identically for the same `trackId` every time — no random, no Math.random — and never makes a network request.

### `RecentUploadCard` shape

```tsx
interface RecentUploadCardProps {
  upload: RecentUpload;
}
```

```tsx
<a
  href={`/dashboard/projects/${upload.projectId}?tab=music&versionId=${upload.versionId}`}
  className="group flex w-36 shrink-0 flex-col gap-2"
>
  <div className="relative">
    <TrackCover trackId={upload.trackId} size={144} />
    {/* play overlay — fades on group-hover */}
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        window.dispatchEvent(new CustomEvent("skitza:play-version", {
          detail: {
            versionId: upload.versionId,
            audioUrl: upload.audioUrl,
            durationMs: upload.durationMs,
          },
        }));
      }}
      aria-label={`Play ${upload.title} ${upload.versionLabel}`}
      className="absolute inset-0 flex items-center justify-center rounded-[var(--radius-md)] bg-black/0 opacity-0 transition-all group-hover:bg-black/40 group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))]"
    >
      <PlayIcon />
    </button>
    {/* unread badge */}
    {upload.unreadComments > 0 && (
      <span
        aria-label={`${upload.unreadComments} unread comments`}
        className="absolute -end-1 -top-1 inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-[rgb(var(--brand-primary))] px-1 font-mono text-[0.65rem] font-semibold text-[rgb(var(--fg-inverse))] ring-2 ring-[rgb(var(--bg-base))]"
      >
        {upload.unreadComments > 99 ? "99+" : upload.unreadComments}
      </span>
    )}
  </div>
  <div className="min-w-0">
    <p className="truncate text-sm font-semibold text-[rgb(var(--fg-primary))]">
      {upload.title}
      <span className="ml-1 font-mono text-xs font-normal text-[rgb(var(--fg-muted))]">
        · {upload.versionLabel}
      </span>
    </p>
    <p className="truncate text-xs text-[rgb(var(--fg-secondary))]">
      {upload.projectClientName} · {formatRelativeTime(upload.uploadedAt)}
    </p>
  </div>
</a>
```

`formatRelativeTime` lives at [`apps/web/src/lib/time/relative.ts`](../../apps/web/src/lib/time/relative.ts) — already in use across the codebase. Returns `"2h"` / `"3d"` / `"Apr 24"` style.

### `PlayIcon`

Inline SVG, 32×32, white fill, triangle. Same pattern as the icons in `audio-uploader.tsx`.

### Section layout

```tsx
<section
  aria-labelledby="recent-uploads-heading"
  data-tour-id="recent-uploads"
  className="mb-10"
>
  <div className="mb-4">
    <p className="font-mono text-[0.66rem] uppercase tracking-[0.2em] text-[rgb(var(--fg-muted))]">
      Studio · Recent uploads
    </p>
    <h2
      id="recent-uploads-heading"
      className="mt-1 font-display text-2xl tracking-tight text-[rgb(var(--fg-primary))]"
    >
      Recent uploads
    </h2>
  </div>

  <div className="flex gap-4 overflow-x-auto sk-scroll-x pb-1">
    {uploads.slice(0, 5).map((u) => <RecentUploadCard key={u.versionId} upload={u} />)}
    {uploads.length > 5 && (
      <a href="/dashboard/music" className="…view-all-card-styles…">
        View all in Music →
      </a>
    )}
  </div>
</section>
```

### Empty / sparse handling

- `uploads.length === 0` → `return null;` early
- `uploads.length === 1..4` → still render the section, fewer cards. Looks fine without a scrollbar.
- `uploads.length === 5..7` → first 5 always visible; remaining 2 scroll into view; "View all" link replaces the 6th visible slot.

## TDD steps

1. **RED** — `track-cover.test.tsx` — assert deterministic output: same `trackId` produces same gradient angle + colors.
2. **GREEN** — implement `TrackCover`.
3. **RED** — `recent-uploads-shelf.test.tsx` — fixtures: 0/1/4/7 uploads. Assert: 0 → null, 1 → one card, 4 → four cards no scrollbar, 7 → first 5 visible + "View all" link. Custom event firing on play click. Badge presence with `unreadComments`.
4. **GREEN** — implement `RecentUploadsShelf` + `RecentUploadCard`.
5. **RED** — a11y test: hover overlay button has `aria-label`, badge has `aria-label`, image has `aria-hidden`.
6. **GREEN** — verify aria attributes are wired.
7. `/skitza-verify`.

## Commit message

```
feat(today): RecentUploadsShelf — horizontal cover-art shelf of last 5–7 uploads

Surfaces the producer's last 5–7 track-version uploads across active
projects in a horizontal Spotify/Apple-Music-style shelf. Each card:
deterministic gradient cover (from trackId hash, no asset
infrastructure needed), track title + version label, project client
name + relative time, hover-revealed play overlay that dispatches
'skitza:play-version' to the existing PersistentPlayer (zero new
audio plumbing), unread-comment badge top-right when artists have
replied since the version uploaded.

Empty state hides the section entirely (silence > "no tracks yet").
5+ uploads adds a "View all in Music →" trailing link.

New: TrackCover component (deterministic gradient covers indexed by
trackId hash + curated 12-color palette). Reusable wherever we need a
default cover image without R2 round-trips.

Story 03 of the today-redesign epic. Component is integrated into
the Today page in Story 06.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```
