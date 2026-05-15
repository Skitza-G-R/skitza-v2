# Clients & Projects — Phase 4: Upload Track modal + manual stage edit

> **For Claude:** Implement via subagent-driven-development. TDD throughout.

**Goal:** Ship the Upload Track modal that wires into all 3 entry points (Album Songs tab "Add song", Song Space hero "Upload new version", Versions tab "Add a new version" drop zone) plus the manual stage-edit menu on Song Space. Per `DESIGN.md §6.4` + `BUILD-NOTES §7.3`.

**Architecture:** Reuse existing audio router multipart upload flow (`initMultipart` → `signPart` × N → `completeMultipart`). New `UploadTrackModal` component drives the form + the upload orchestration. New tRPC mutation `project.setTrackStage` for the standalone "change stage" affordance. Optional `workflowStage` parameter on the modal's submit advances the track stage atomically with the upload.

**Branch:** Continuing on `clients-projects-phase-1`. HEAD: `1ab11a4`.

---

## Decisions baked in

| # | Decision | Reasoning |
|---|---|---|
| 1 | **Reuse the existing multipart upload** — no new "simple PUT" endpoint | The audio router already implements `initMultipart` / `signPart` / `completeMultipart`. Single-part multipart works fine for small files; chunking only kicks in above the threshold. |
| 2 | **Modal orchestrates the upload client-side** | Track creation (if new) → version row creation → multipart upload → version patching → stage update. All sequential, progress bar in modal. |
| 3 | **5MB chunk size** | Balanced — small enough for slow connections, large enough to keep `signPart` round-trips reasonable. Configurable constant. |
| 4 | **New mutation `project.setTrackStage({ trackId, workflowStage })`** | Single-purpose. Updates `project_tracks.workflow_stage`. Used by both the upload modal (with the stage picker selection) AND the standalone "change stage" menu. |
| 5 | **Stage picker is optional in the modal** | Default = no stage change. Modal explains "Optionally advance the stage" with a dropdown. If user leaves it on "No change", the track's stage stays. |
| 6 | **Same modal serves all 3 entry points** | Props determine: pre-selected song (if any), pre-selected version label, default file accept (audio/*). |
| 7 | **Abort on close** | If the user closes the modal mid-upload, call `audio.abortMultipart` to reclaim R2 storage. |
| 8 | **Disabled state for offline / no R2 cred** | Detected via try/catch on `initMultipart`. Modal shows an error state if init fails. |
| 9 | **Stage menu on Song Space is in the hero or above the tabs** | Per DESIGN: "small 'change stage' affordance on song page". Render as a small button next to the stage pill, opening a Radix DropdownMenu or shadcn-style dropdown listing the 5 stages. |

---

## Component plan

### New tRPC mutations
- `project.setTrackStage({ trackId, workflowStage })` — Authenticates via `producerProcedure`. Verifies track→project→producer ownership chain. Updates `project_tracks.workflow_stage`. Returns `{ ok: true, workflowStage }`.

### New components
- `apps/web/src/components/dashboard/song/upload-track-modal.tsx` — Radix Dialog. Form fields:
  - Song picker (dropdown of existing tracks OR "+ New song" → reveals song-name input)
  - Version label (text, auto-bumped to "v{N+1}" where N is the highest existing version label number)
  - Stage selector (dropdown: "No change" + 5 stages from `WORKFLOW_STAGES`)
  - Description (textarea, optional, "Notes for the artist about this version")
  - File drop zone (drag + drop OR click to browse, accept `audio/*`)
- `apps/web/src/components/dashboard/song/change-stage-menu.tsx` — Small button next to the song's stage pill. Clicking opens a dropdown listing the 5 stages. Picking one calls `project.setTrackStage` + closes the menu. Toast on success.

### Wiring
- Album Songs tab `add-song` button → opens `<UploadTrackModal projectId={projectId} mode="new-song">` — song picker defaults to "+ New song"
- Song Space "Upload new version" hero CTA → opens `<UploadTrackModal projectId={projectId} mode="new-version" trackId={song.id} defaultLabel="v{N+1}">`
- Versions tab "Add a new version" drop zone → same as Song Space hero. Drop zone also accepts file drop → opens modal with file pre-selected.
- Song Space hero (or above tabs): mount `<ChangeStageMenu trackId={song.id} current={song.workflowStage} />` so the producer can advance the stage without uploading.

### Upload flow (client-side orchestration inside UploadTrackModal)

```ts
async function uploadFile(file: File, trackId: string, label: string): Promise<{ versionId: string; audioUrl: string }> {
  // 1. Create the version row with audioUrl=null
  const version = await trpc.project.addVersion.mutate({
    trackId,
    label,
    audioUrl: null,
    durationMs: undefined,
  });

  // 2. Init multipart upload
  const { uploadId, key } = await trpc.audio.initMultipart.mutate({
    trackVersionId: version.id,
    filename: file.name,
    sizeBytes: file.size,
    contentType: file.type || "audio/mpeg",
  });

  // 3. Chunk + sign + upload each part
  const CHUNK_SIZE = 5 * 1024 * 1024; // 5MB
  const partCount = Math.max(1, Math.ceil(file.size / CHUNK_SIZE));
  const parts: { partNumber: number; eTag: string }[] = [];

  for (let i = 0; i < partCount; i++) {
    const partNumber = i + 1;
    const start = i * CHUNK_SIZE;
    const end = Math.min(start + CHUNK_SIZE, file.size);
    const chunk = file.slice(start, end);

    const { url } = await trpc.audio.signPart.mutate({ key, uploadId, partNumber });
    const res = await fetch(url, { method: "PUT", body: chunk });
    if (!res.ok) {
      // Cleanup
      await trpc.audio.abortMultipart.mutate({ key, uploadId });
      throw new Error(`Part ${partNumber} upload failed: ${res.status}`);
    }
    const eTag = res.headers.get("ETag")?.replaceAll('"', "") ?? "";
    parts.push({ partNumber, eTag });
    onProgress?.((parts.length / partCount) * 100);
  }

  // 4. Complete multipart
  const durationMs = await tryGetDurationMs(file).catch(() => undefined);
  const { url: audioUrl } = await trpc.audio.completeMultipart.mutate({
    key,
    uploadId,
    parts,
    trackVersionId: version.id,
    sizeBytes: file.size,
    ...(durationMs ? { durationMs } : {}),
  });

  return { versionId: version.id, audioUrl };
}

async function tryGetDurationMs(file: File): Promise<number> {
  return new Promise((resolve, reject) => {
    const audio = document.createElement("audio");
    audio.preload = "metadata";
    audio.onloadedmetadata = () => {
      resolve(Math.round(audio.duration * 1000));
      URL.revokeObjectURL(audio.src);
    };
    audio.onerror = () => reject(new Error("Could not read duration"));
    audio.src = URL.createObjectURL(file);
  });
}
```

Wrap in `useTransition` for the submit. Show a progress bar during the chunk upload. Close on success + toast + `router.refresh()`.

---

## Test strategy (TDD)

- `setTrackStage` test — DB-mocked unit test asserting the ownership chain + the update query (see `client-contacts-create.test.ts` for the established mock pattern).
- `upload-track-modal.test.tsx` — source-grep: assert Radix Dialog imports, all 4 form fields, the multipart functions imported, useTransition + useRouter + useToast pattern, file accept attribute, no forbidden CSS tokens.
- `change-stage-menu.test.tsx` — source-grep: assert Radix DropdownMenu (or fallback) imports, all 5 stages in source, calls `setTrackStage`, toast on success.
- Update existing tests that referenced `Coming soon` on the "Add song" / "Upload new version" / drop-zone — they should now trigger the modal.

---

## Done criteria

- [ ] `project.setTrackStage` mutation + test
- [ ] `UploadTrackModal` component + test
- [ ] `ChangeStageMenu` component + test
- [ ] All 3 entry points wired (Album Songs tab + Song Space hero + Versions drop zone)
- [ ] "Change stage" menu mounted on Song Space
- [ ] Disabled "Coming soon" stubs removed from the affordances (they're real now)
- [ ] `pnpm typecheck && pnpm -F web lint && pnpm test` green
- [ ] No forbidden CSS tokens
- [ ] Commits with Co-Authored-By trailer

---

## What this DOES NOT cover (future fast-follows)
- Re-uploading a failed/partial upload (abort on close = lost state)
- Drag-to-reorder versions within the Versions tab
- "Edit version" affordance (rename, change description after the fact)
- Email notification to the artist when a new version is uploaded — handled by `addVersion`'s `after()` hook already
- Real-time progress sync across tabs
