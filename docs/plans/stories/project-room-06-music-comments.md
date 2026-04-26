# Story 06 — Music tab — range comments + cross-version unresolved persistence

**Epic:** Project Room redesign 2026-04-26
**Architecture ref:** [`docs/plans/active/2026-04-26-project-room-redesign-architecture.md` § 5 Music components / § 8.4 Cross-version test](../active/2026-04-26-project-room-redesign-architecture.md)
**PRD anchor:** [§11.6 Music tab redesign — comments + cross-version unresolved](../../product/PRD.md)
**Depends on:** S01 (`end_timestamp_ms` column + version-unresolved index), S02 (`addRangeComment` mutation + `projectRoom.music.unresolvedComments` query), S05 (track row UI to host the overlay)
**Blocks:** none — terminal Music story
**Subagent:** `skitza-tdd-implementer` + `skitza-ux-critic`

## Goal

Layer two niche-defining comment behaviors over the Music tab from S05:

1. **Range comments** (Pibox pattern) — drag across the waveform to comment on a span: "the verse from 0:30–1:15 needs work."
2. **Cross-version unresolved persistence** (Dropbox Replay pattern) — when you ship V2, V1's unresolved comments stay visible on V2 (rendered with a `(from V1)` subscript) until explicitly resolved by either party. This forces the producer to confront open feedback while the new version plays.

Voice memo comments are **deferred to v2** per PRD §11.6 — out of scope for this story.

## User story

As an artist reviewing my producer's mix, I want to drag across the **section** that has an issue (not just a single timestamp) and comment on the whole range, so the producer knows exactly which part to fix. As a producer, when I ship V2, I want to see my artist's V1 unresolved comments still visible on V2 — so I can't accidentally ship without addressing them.

## Acceptance criteria

### Range comments
- [ ] **Drag-on-waveform** → range selection. Drag start = `timestampMs`, drag end = `endTimestampMs`. Visual: a translucent overlay band on the waveform during drag.
- [ ] **Click on free space below waveform** → point comment (existing behavior, unchanged). Single timestamp, `endTimestampMs = NULL`.
- [ ] **Auto-pause** while typing in the comment composer (existing behavior preserved).
- [ ] Composer chip shows the selected range (`0:30 – 1:15` for ranges; `0:30` for points).
- [ ] On submit → `projectRoom.addRangeComment({ versionId, body, timestampMs, endTimestampMs })` (or `addPointComment` if `endTimestampMs` is NULL — reuse existing point-comment mutation).
- [ ] Range comments render on the waveform as a translucent band (not just a point pin). Click on the band → seeks to `timestampMs`, opens the comment thread.
- [ ] Validation: `endTimestampMs > timestampMs`; both clamped to `>= 0`. Server-side enforced (already from S02).

### Cross-version unresolved persistence
- [ ] When the active version changes (V1 → V2), the comment list shows:
  - Comments posted on V2 (sorted by `created_at` descending)
  - PLUS unresolved comments from V1 (and earlier versions if multi-version), each tagged with `(from V<N>)` subscript next to the timestamp.
- [ ] Resolved comments stay archived with the version they were resolved on; they don't pollute new versions.
- [ ] The track-row's "unresolved badge" count reflects the **track-level** unresolved count (across all versions), not just the active version.
- [ ] Resolve / Unresolve toggle: `projectRoom.resolveComment({ commentId })` / `projectRoom.unresolveComment({ commentId })`. Both producer and artist allowed.
- [ ] After resolving a "from V1" comment shown on V2: the comment disappears from V2's list (it's now resolved on V2 — actually, see decision: do we mark it resolved on the version it's anchored to, or on the version it was resolved from?). **Decision**: store `resolved_on_version_id` if needed for audit; for v1 the simple model is `resolved_at` is set on the comment row, period. The comment vanishes from all "unresolved" lists.

### Component tree (new)
- [ ] [`apps/web/src/components/dashboard/project/sub-tabs/music/range-comment-overlay.tsx`](../../apps/web/src/components/dashboard/project/sub-tabs/music/range-comment-overlay.tsx) — drag-on-waveform → range-selection → composer flow
- [ ] [`apps/web/src/components/dashboard/project/sub-tabs/music/comment-thread.tsx`](../../apps/web/src/components/dashboard/project/sub-tabs/music/comment-thread.tsx) — render a single comment with point/range visual + `(from V<N>)` subscript when applicable
- [ ] [`apps/web/src/components/dashboard/project/sub-tabs/music/comments-panel.tsx`](../../apps/web/src/components/dashboard/project/sub-tabs/music/comments-panel.tsx) — list of comments for the active version, including cross-version unresolved threads at the top

### Wiring updates to S05 components
- [ ] [`track-row.tsx`](../../apps/web/src/components/dashboard/project/sub-tabs/music/track-row.tsx) (from S05) updates:
  - Renders `<RangeCommentOverlay>` over the waveform
  - Renders `<CommentsPanel>` below the waveform for the active version
  - Unresolved badge count = `tracks[i].unresolvedComments.length` (the cross-version-aware payload from S02)
- [ ] [`music-sub-tab.tsx`](../../apps/web/src/components/dashboard/project/sub-tabs/music-sub-tab.tsx) — passes `unresolvedComments` from the `projectRoom.music` query down to each `<TrackRow>`.

### Tests
- [ ] `range-comment-overlay.test.tsx`:
  - Mouse-down at `x=100, y=20` on a waveform → captures `timestampMs` derived from x-position
  - Drag to `x=300` → updates `endTimestampMs`, renders translucent band
  - Mouse-up → opens composer with `[0:30 – 1:15]` chip
  - Submit → calls `addRangeComment` mutation with correct args
  - Mouse-down + immediate mouse-up (no drag, < 5px movement) → falls back to point comment (existing behavior)
- [ ] `comment-thread.test.tsx`:
  - Point comment renders without `(from V<N>)` subscript when on its own version
  - Comment authored on V1 but rendered on V2 shows `(from V1)` subscript
  - Range comment renders with the `0:30 – 1:15` time format
  - Click resolve → calls `resolveComment` mutation
- [ ] `comments-panel.test.tsx`:
  - Active version's comments rendered first
  - Unresolved comments from prior versions appended below with subscripts
  - Resolved comments NOT shown
  - Empty state ("No comments on this version yet — drag the waveform to leave one.")
- [ ] **Cross-version integration test** at the tRPC layer was already covered in S02 (`project-room.music-cross-version.test.ts`). Confirm it still passes after S06 wires the UI.
- [ ] `/skitza-verify` passes.
- [ ] `skitza-ux-critic` review for Pibox-tier comment UX.

## Technical context

### Range comments — DB model

```sql
-- From S01 (already applied):
ALTER TABLE track_comments ADD COLUMN end_timestamp_ms INTEGER;

-- Semantics:
--   timestamp_ms = N, end_timestamp_ms = NULL → point comment at N
--   timestamp_ms = N, end_timestamp_ms = M (M > N) → range comment N..M
```

Drizzle/TS shape:

```ts
type TrackComment = {
  id: string;
  versionId: string;
  authorName: string;
  authorEmail: string;
  body: string;
  timestampMs: number;
  endTimestampMs: number | null;  // ← S01
  resolvedAt: Date | null;
  fromProducer: boolean;
  createdAt: Date;
};
```

### Cross-version query (already implemented in S02)

```ts
// projectRoom.music.unresolvedComments — joined query:
const unresolvedComments = await db
  .select(/* with joins for version label */)
  .from(trackComments)
  .innerJoin(trackVersions, eq(trackVersions.id, trackComments.versionId))
  .where(
    and(
      eq(trackVersions.trackId, trackId),
      isNull(trackComments.resolvedAt),
    ),
  )
  .orderBy(desc(trackComments.createdAt));
```

Each row carries enough context to render: the comment body, its timestamp on its OWN version, and the `versionLabel` of where it was originally posted (for the `(from V<N>)` subscript).

### Range overlay implementation

```tsx
// Track mouse drag on the waveform container:
function onWaveformMouseDown(e: React.MouseEvent) {
  const rect = e.currentTarget.getBoundingClientRect();
  const startX = e.clientX - rect.left;
  const startMs = Math.round((startX / rect.width) * durationMs);
  setDragStart(startMs);
  // ... attach window mousemove + mouseup listeners
}

function onMouseUp(e: MouseEvent) {
  const endMs = /* same calc */;
  const span = Math.abs(endMs - startMs);
  if (span < 200 /* < 200ms drag treated as point */) {
    setComposerMode({ kind: "point", timestampMs: startMs });
  } else {
    setComposerMode({
      kind: "range",
      timestampMs: Math.min(startMs, endMs),
      endTimestampMs: Math.max(startMs, endMs),
    });
  }
}
```

200ms threshold avoids accidental ranges from imprecise clicks.

### Auto-pause while typing

Existing behavior — the [`PersistentPlayer`](../../apps/web/src/components/audio/persistent-player.tsx) already handles this via a `pauseRequest` event from the comment composer. Reuse, don't fork.

### Visual: range band on waveform

```css
.waveform-range-band {
  position: absolute;
  background: rgb(var(--brand-primary) / 0.18);
  border-left: 2px solid rgb(var(--brand-primary));
  border-right: 2px solid rgb(var(--brand-primary));
  pointer-events: none;
  /* left + width set inline based on timestamp_ms / end_timestamp_ms */
}
```

For accessibility: provide a keyboard-accessible alternative — `Shift+R` while focused on a comment-pin opens a range-input composer. Document in the keyboard shortcuts list ([`apps/web/src/lib/keyboard/use-shortcuts.ts`](../../apps/web/src/lib/keyboard/use-shortcuts.ts)).

## TDD steps

1. **RED** — `range-comment-overlay.test.tsx`. Mock the waveform container's `getBoundingClientRect`. Assert mouse-down → mouse-up (>200ms drag) opens the composer in `range` mode with correct args.
2. **GREEN** — implement `range-comment-overlay.tsx`.
3. **RED** — `comment-thread.test.tsx`. Two fixtures: own-version comment (no subscript) + cross-version comment (renders `(from V1)` subscript).
4. **GREEN** — implement `comment-thread.tsx`.
5. **RED** — `comments-panel.test.tsx`. Mixed list: 2 active-version comments + 1 unresolved from V1. Assert correct order, subscripts, no resolved comments.
6. **GREEN** — implement `comments-panel.tsx`.
7. Wire into S05's `track-row.tsx` — render overlay + comments panel.
8. **Manual smoke test**: drag a range on the waveform, post a comment, switch versions, confirm it shows up with subscript on V2. Resolve it. Confirm it disappears from both versions' "unresolved" lists.
9. **Cross-version regression check** — re-run `project-room.music-cross-version.test.ts` (from S02) — must still pass.
10. **Subagent loop** — `skitza-ux-critic`.
11. `/skitza-verify` passes.

## Test file paths

- `apps/web/src/components/dashboard/project/sub-tabs/music/__tests__/range-comment-overlay.test.tsx`
- `apps/web/src/components/dashboard/project/sub-tabs/music/__tests__/comment-thread.test.tsx`
- `apps/web/src/components/dashboard/project/sub-tabs/music/__tests__/comments-panel.test.tsx`

## Definition of done

- [ ] Range comments storable and renderable
- [ ] Click on range band → seeks to start timestamp
- [ ] Cross-version unresolved persistence visible on V2 (and beyond) with subscripts
- [ ] Resolve/Unresolve toggles work both directions
- [ ] No regression on point comments (existing behavior)
- [ ] `skitza-ux-critic` review clean
- [ ] `/skitza-verify` passes

## Commit message

```
feat(project-room): range comments + cross-version unresolved persistence

Implements PRD §11.6's two niche-defining comment behaviors over the
Music tab redesign from S05.

Range comments (Pibox pattern):
- Drag on waveform → range comment spanning [start_ms, end_ms].
- Click on free space below waveform → point comment (unchanged).
- 200ms drag threshold prevents accidental ranges from imprecise clicks.
- Renders as a translucent band on the waveform with left+right brackets.
- Click on the band seeks to start_ms and opens the thread.
- Stored in track_comments.end_timestamp_ms (nullable, from S01).
  NULL = point, non-NULL = range. Validation: end > start, both >= 0.

Cross-version unresolved persistence (Dropbox Replay pattern):
- When viewing V2, V1's unresolved comments remain visible with a
  "(from V1)" subscript next to the timestamp.
- Forces the producer to face open feedback while the new version plays.
- Resolve / Unresolve allowed by both producer and artist; once
  resolved, the comment disappears from all "unresolved" lists.
- Powered by projectRoom.music.unresolvedComments (S02), which joins
  track_comments → track_versions on track_id and filters by
  resolved_at IS NULL. Uses the track_comments_version_unresolved_idx
  index from S01.

Auto-pause while typing reuses the existing PersistentPlayer pauseRequest
event — no new audio infra. Keyboard alternative for range selection
(Shift+R while focused on a pin) preserves accessibility.

Voice memo comments are deferred to v2 per PRD §11.6 — out of scope.

Story 06 of the project-room-redesign epic. Depends on S01 (schema),
S02 (addRangeComment + cross-version query), S05 (track-row to host
the overlay). Reviewed by skitza-ux-critic.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```
