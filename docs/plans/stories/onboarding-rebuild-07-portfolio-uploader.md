# Story 07 — Portfolio uploader card (wraps AudioUploader)

> Skitza-BMAD · Story 07 of 10
> Architecture: §4.5
> **Depends on:** Story 02 (shell), Story 06 (sibling component on the same step)

---

## As a producer at Step 4 of onboarding...

I want to upload one or more tracks via drag-and-drop, see live progress, and have them flagged correctly as portfolio tracks — without dealing with anything technical.

## Acceptance criteria

- [ ] New component `<PortfolioUploaderCard producerId={...} onTrackComplete={...} />` renders a drop-zone wrapping the existing `<AudioUploader />`.
- [ ] On file accept: server action creates a placeholder `portfolio_tracks` row + a `track_versions` row, returns `{trackId, trackVersionId}`.
- [ ] Component then mounts `<AudioUploader trackVersionId={trackVersionId} onComplete={...} />` and the existing multipart pipeline runs.
- [ ] On `onComplete`: server action `audio.completeMultipart` finalizes the row (this is existing behavior — verify the existing path works).
- [ ] After upload completes: `onTrackComplete({trackId, title})` callback fires for the parent step.
- [ ] If the user uploads multiple tracks, each completes independently — list updates incrementally.
- [ ] Uploaded tracks show as small chips/cards below the dropzone with the file name.
- [ ] Clicking a chip's "remove" X deletes the placeholder via `portfolio.deleteTrack` (or equivalent — check router).
- [ ] All uploads are flagged as portfolio tracks (not project tracks). Verify via `portfolioTracks.context = "portfolio"` or whatever flag exists; flag if no such distinction exists today.
- [ ] Continue button on the parent step is disabled while any upload is in progress (read `useMultipartUpload`'s `state.uploading`).

## Technical context

### Files to touch

**Create:**
- `apps/web/src/components/onboarding/portfolio-uploader-card.tsx` — the new card.
- `apps/web/src/components/onboarding/__tests__/portfolio-uploader-card.test.tsx` — RTL test.

**Modify:**
- Possibly extend `apps/web/src/server/trpc/routers/portfolio.ts` with a `createPlaceholder` mutation if one doesn't exist. Verify first by `grep -n "createPlaceholder\|createTrack" apps/web/src/server/trpc/routers/portfolio.ts`.

### Story-author tasks BEFORE writing code

1. **Read** `apps/web/src/components/audio/audio-uploader.tsx` end-to-end to confirm props (`trackVersionId`, `onComplete: (r: { url, key }) => void`).
2. **Read** `apps/web/src/server/trpc/routers/portfolio.ts` to find: track creation, deletion, and whether there's a separate "portfolio track" vs "project track" distinction.
3. **Read** `apps/web/src/lib/audio/use-multipart-upload.ts` (referenced by AudioUploader) to understand the upload state shape — surface `state.uploading` to the parent if needed.
4. **Read** `apps/web/src/server/trpc/routers/audio.ts` if present, for the multipart-complete shape.

### Component contract

```tsx
export function PortfolioUploaderCard({
  producerId,
  onTrackComplete,
  className,
}: {
  producerId: string;
  onTrackComplete: (track: { id: string; title: string }) => void;
  className?: string;
})
```

### Edge cases

- File ≥ 500 MB: AudioUploader already rejects (`MAX_SIZE_BYTES = 500 * 1024 * 1024`). Verify error surface.
- Non-audio file: AudioUploader handles via accept filter — verify behavior.
- Network drop mid-upload: existing multipart-upload hook's retry/abort behavior applies. Don't reinvent.
- User clicks Continue/Skip while upload is in progress: parent should disable Continue based on this card's `isUploading` callback or state.

### Conventions

- All R2 / storage logic lives in existing hooks + actions. This card is presentational + orchestrating.
- 44px tap targets, CSS vars, `prefers-reduced-motion` respected.

## TDD steps

This is the most code-heavy story. Bias for fewer, higher-value tests:
- (vitest+RTL) renders dropzone
- (vitest+RTL) drop file → mocks placeholder action → mocks AudioUploader's onComplete → asserts onTrackComplete fires with expected shape
- (vitest+RTL) clicking remove on a chip → mocks delete action → asserts chip removed

## Commit

```bash
git commit -m "$(cat <<'EOF'
feat(onboarding): portfolio uploader card wrapping AudioUploader

New <PortfolioUploaderCard /> orchestrates the existing R2 multipart
pipeline:
  1. On file drop → server action creates placeholder portfolio_tracks
     + track_versions rows
  2. Mount existing <AudioUploader> with the trackVersionId
  3. AudioUploader uses useMultipartUpload to chunk + transfer
  4. On complete → existing audio.completeMultipart finalizes the row
  5. Card surfaces the new track as a chip with a remove affordance

[If portfolio.createPlaceholder was added:] Thin wrapper around
existing portfolio.createTrack, parameterized for the wizard's
"empty placeholder" pattern (no audioUrl, no artworkUrl yet).

Continue button on parent step (Story 08) reads `isUploading` from
this component to gate advancement during in-flight uploads.

Story 07 of 10 — `feat/onboarding-rebuild`.

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

## QA review checklist

### Spec compliance

- [ ] No new R2 logic — fully reuses AudioUploader + useMultipartUpload
- [ ] Tracks correctly flagged as portfolio (not project) tracks
- [ ] Multiple uploads work; each completes independently
- [ ] Remove chip → DB row deleted

### Code quality

- [ ] No leaky state across unmount/remount
- [ ] 44px tap targets, especially the remove X
- [ ] Reuses existing audio styling primitives

## ⚠ Story author safeguards

- This story may turn out to need MORE work than estimated if `portfolio.createPlaceholder` doesn't exist. If that's the case, the dev subagent should add it (small mutation) within this story. If it expands beyond the story scope, FLAG in the report rather than silently extending.
- Per CLAUDE.md mistake log 2026-04-23 (R2 CORS): if upload fails with "Failed to fetch" in browser despite server returning 200s, check R2 CORS policy first.
