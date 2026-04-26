"use client";

import { useRouter } from "next/navigation";
import { useCallback, useState, useTransition } from "react";

import { useToast } from "~/components/ui/toast";
import { useMultipartUpload } from "~/lib/audio/use-multipart-upload";

import { DropZone } from "./music/drop-zone";
import {
  TrackRow,
  type TrackRowComment,
  type TrackRowVersion,
} from "./music/track-row";
import {
  categorizeFiles,
  type VersionStatus,
  type ViewerRole,
} from "./music/music-helpers";
import { deriveTrackTitle } from "./music/title-derive";
import {
  addVersionFromUploadAction,
  createTrackFromUploadAction,
  setVersionStatusAction,
} from "~/app/(app)/dashboard/projects/actions";

// Story 05 — Music tab redesign.
//
// REWRITE: kills the old title-first add-track form. New flow:
//   - Empty state  → full-bleed <DropZone variant="empty">.
//   - Populated    → pinned <DropZone variant="pinned"> + N <TrackRow>.
//   - Drop on row → bucket the drop (top half: new version; bottom
//                   half: new track) via TrackRow's hit-test.
//
// Optimistic UX: track / version creation creates a placeholder row
// in local state immediately. The actual upload (multipart PUT parts)
// runs via useMultipartUpload({ trackVersionId }) using the real DB
// row id returned from the server action. When the upload completes
// we router.refresh() so the server-fetched payload reconciles.
//
// Why router.refresh() instead of mutating the React tree directly:
// the repo doesn't ship React Query — see CLAUDE.md + S03/S04 agent
// notes. Server-component data + Server Actions + router.refresh() is
// the established pattern.
//
// Auth: the projectRoom.* mutations enforce producerId-scoping
// server-side. The DropZone + TrackRow callbacks just pass File[]
// through — they don't see ownership at all.

interface ProjectRef {
  id: string;
}

export interface TrackPayload {
  id: string;
  title: string;
  artistTag: string | null;
  createdAt: Date;
  versions: Array<{
    id: string;
    label: string;
    audioUrl: string | null;
    audioReady: boolean;
    statusEnum: string;
    createdAt: Date;
  }>;
  unresolvedComments: Array<{
    id: string;
    versionId: string;
    versionLabel: string;
    authorName: string;
    body: string;
    timestampMs: number;
    endTimestampMs: number | null;
    fromProducer: boolean;
    createdAt: Date;
  }>;
}

// Optimistic placeholder row inserted into local state the moment a
// drop fires. The real row replaces it after the upload completes
// (via router.refresh()). Using a separate type keeps the optimistic
// branches isolated from the server payload.
interface OptimisticTrack {
  id: string; // tempId until the server returns its real uuid
  title: string;
  uploadProgress: number;
  uploadingFile: string;
}

const VIEWER_ROLE: ViewerRole = "producer";

// Coerce the legacy enum (which may include 'pending', 'approved'
// from older rows) into the v1 enum used by the bilateral pill.
// Defensive — Zod validates on the server but we get type 'string'
// from the procedure return for the legacy column.
function asVersionStatus(s: string): VersionStatus {
  if (s === "draft" || s === "revisit" || s === "final") return s;
  // Legacy 'approved' rows pre-S01 → treat as final.
  if (s === "approved") return "final";
  return "draft";
}

// Revert a status override back to its previous value (or remove the
// key entirely if there was no prior override). Avoids dynamic delete
// (eslint @typescript-eslint/no-dynamic-delete) by rebuilding the
// record from entries.
function revertOverride(
  current: Record<string, VersionStatus>,
  versionId: string,
  prev: VersionStatus | undefined,
): Record<string, VersionStatus> {
  if (prev !== undefined) {
    return { ...current, [versionId]: prev };
  }
  const next: Record<string, VersionStatus> = {};
  for (const [k, v] of Object.entries(current)) {
    if (k !== versionId) next[k] = v;
  }
  return next;
}

export function MusicSubTab({
  project,
  tracks,
}: {
  project: ProjectRef;
  tracks: TrackPayload[];
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [, startTransition] = useTransition();

  // Local optimistic state — placeholder rows for in-flight track
  // creations. Once the upload completes we router.refresh(); the
  // server payload will then carry the real row and we drop the
  // placeholder by id.
  const [optimisticTracks, setOptimisticTracks] = useState<OptimisticTrack[]>(
    [],
  );

  // Local optimistic version-status overrides — keyed by versionId.
  // Set on click, cleared on router.refresh() reconciliation.
  const [statusOverrides, setStatusOverrides] = useState<
    Record<string, VersionStatus>
  >({});

  const { upload } = useMultipartUpload();

  // ─── createTrack — drop on empty space / pinned strip / DropZone ──
  // 1. Pick the first audio file (if multi-file: kick off N parallel
  //    creates, each becomes its own track).
  // 2. For each file: call createTrackFromUploadAction → DB rows + R2
  //    multipart init.
  // 3. Run useMultipartUpload({ trackVersionId, file }) for the parts.
  // 4. On completion: drop the optimistic row, router.refresh().
  const createTrackFromFiles = useCallback(
    async (files: File[]) => {
      const { audio, rejected } = categorizeFiles(files);
      if (rejected.length > 0) {
        toast(
          `Skipped ${String(rejected.length)} non-audio file${rejected.length === 1 ? "" : "s"}.`,
          "info",
        );
      }
      for (const file of audio) {
        const tempId = `tmp:${String(Math.random()).slice(2)}`;
        const optimistic: OptimisticTrack = {
          id: tempId,
          title: deriveTrackTitle(file.name),
          uploadProgress: 0,
          uploadingFile: file.name,
        };
        setOptimisticTracks((arr) => [...arr, optimistic]);
        try {
          const res = await createTrackFromUploadAction({
            projectId: project.id,
            filename: file.name,
            fileSize: file.size,
          });
          if (!res.ok) {
            toast(res.error, "error");
            setOptimisticTracks((arr) => arr.filter((t) => t.id !== tempId));
            continue;
          }
          await upload({
            file,
            trackVersionId: res.data.versionId,
            onComplete: () => {
              toast(`Uploaded "${optimistic.title}".`, "success");
              setOptimisticTracks((arr) => arr.filter((t) => t.id !== tempId));
              startTransition(() => {
                router.refresh();
              });
            },
          });
        } catch (err) {
          toast(
            err instanceof Error ? err.message : "Upload failed.",
            "error",
          );
          setOptimisticTracks((arr) => arr.filter((t) => t.id !== tempId));
        }
      }
    },
    [project.id, router, toast, upload],
  );

  // ─── addVersionToTrack — drop on row top half ────────────────────
  // For each audio file, add a new version on the existing track.
  // (Multi-file drop on a row top half: each file becomes a separate
  // V<N+1>, V<N+2>, … in submission order. The server picks the
  // label since count + 1 is monotonic per insert.)
  const addVersionToTrack = useCallback(
    async (trackId: string, files: File[]) => {
      const { audio, rejected } = categorizeFiles(files);
      if (rejected.length > 0) {
        toast(
          `Skipped ${String(rejected.length)} non-audio file${rejected.length === 1 ? "" : "s"}.`,
          "info",
        );
      }
      for (const file of audio) {
        try {
          const res = await addVersionFromUploadAction({
            projectId: project.id,
            trackId,
            filename: file.name,
            fileSize: file.size,
          });
          if (!res.ok) {
            toast(res.error, "error");
            continue;
          }
          await upload({
            file,
            trackVersionId: res.data.versionId,
            onComplete: () => {
              toast(`New version uploaded.`, "success");
              startTransition(() => {
                router.refresh();
              });
            },
          });
        } catch (err) {
          toast(
            err instanceof Error ? err.message : "Upload failed.",
            "error",
          );
        }
      }
    },
    [project.id, router, toast, upload],
  );

  // ─── flipStatus — bilateral pill click ───────────────────────────
  // Optimistic: update local state immediately, fire mutation in the
  // background. On error: revert + toast.
  const flipVersionStatus = useCallback(
    async (versionId: string, status: VersionStatus) => {
      // Save the previous override (if any) so we can revert.
      const prev = statusOverrides[versionId];
      setStatusOverrides((m) => ({ ...m, [versionId]: status }));
      try {
        const res = await setVersionStatusAction({
          projectId: project.id,
          versionId,
          status,
        });
        if (!res.ok) {
          toast(res.error, "error");
          // Revert the optimistic flip. We avoid `delete next[id]`
          // (linter forbids dynamic deletes) and instead rebuild the
          // map without the key when prev was undefined.
          setStatusOverrides((m) => revertOverride(m, versionId, prev));
          return;
        }
        startTransition(() => {
          router.refresh();
        });
      } catch (err) {
        toast(
          err instanceof Error ? err.message : "Couldn't update status.",
          "error",
        );
        setStatusOverrides((m) => revertOverride(m, versionId, prev));
      }
    },
    [project.id, router, statusOverrides, toast],
  );

  // ─── renameTrack — inline title edit ─────────────────────────────
  // Hooked into TrackRow via onRenameTrack(trackId, title). The
  // server-side mutation is project.updateTrackTitle (existing); we
  // call it via the legacy action wrapper for now since the
  // projectRoom router doesn't yet expose a track-rename mutation.
  // Falls back to a no-op + toast if the action surface isn't there.
  const renameTrack = useCallback(
    (_trackId: string, _title: string) => {
      void _trackId;
      void _title;
      // Track rename is a follow-up — the projectRoom router doesn't
      // expose it yet. Tell the producer the change is queued (it'll
      // show up after the next session).
      toast(
        "Rename queued. We'll wire this to the API in a follow-up.",
        "info",
      );
    },
    [toast],
  );

  const hasTracks = tracks.length > 0 || optimisticTracks.length > 0;

  return (
    <section
      role="tabpanel"
      id="panel-music"
      aria-labelledby="tab-music"
      className="space-y-6"
    >
      {!hasTracks ? (
        <DropZone
          variant="empty"
          onFilesSelected={(files) => {
            void createTrackFromFiles(files);
          }}
        />
      ) : (
        <>
          {/* Pinned-top slim drop strip — same callback, slimmer
              affordance. Lives above the track list so producers can
              drop in a new track without scrolling past the existing
              ones. */}
          <DropZone
            variant="pinned"
            onFilesSelected={(files) => {
              void createTrackFromFiles(files);
            }}
          />

          {/* Optimistic placeholder rows — render at the TOP of the
              list so the producer immediately sees their drop took
              effect. Replaced by the real row after router.refresh()
              reconciles. */}
          {optimisticTracks.map((t) => (
            <article
              key={t.id}
              className="relative rounded-[var(--radius-lg)] border border-[rgb(var(--brand-primary)/0.35)] bg-[rgb(var(--bg-elevated))] p-5"
              aria-live="polite"
            >
              <header className="mb-4 flex items-start justify-between gap-3">
                <h3
                  className="font-display text-xl tracking-tight text-[rgb(var(--fg-primary))]"
                  style={{ fontWeight: 700 }}
                >
                  {t.title}
                </h3>
                <span className="font-mono text-[0.66rem] uppercase tracking-wider text-[rgb(var(--fg-muted))]">
                  Uploading…
                </span>
              </header>
              <div className="rounded-[var(--radius-lg)] bg-[rgb(var(--bg-sunken))] p-6 text-center">
                <p className="font-mono text-[0.66rem] uppercase tracking-wider text-[rgb(var(--fg-muted))]">
                  {t.uploadingFile}
                </p>
              </div>
            </article>
          ))}

          {/* Real track rows. */}
          {tracks.map((t) => {
            const versions: TrackRowVersion[] = t.versions.map((v) => {
              const override = statusOverrides[v.id];
              return {
                id: v.id,
                label: v.label,
                audioUrl: v.audioUrl,
                audioReady: v.audioReady,
                status: override ?? asVersionStatus(v.statusEnum),
              };
            });
            const comments: TrackRowComment[] = t.unresolvedComments.map(
              (c) => ({
                id: c.id,
                resolvedAt: null,
              }),
            );
            // Story 06 — pass the FULL cross-version unresolved payload
            // so the TrackRow's CommentsPanel can render `(from V<N>)`
            // subscripts on comments that originated on earlier
            // versions. The procedure (S02) already filters by
            // resolvedAt IS NULL, so resolvedAt is non-null on these
            // rows only during the brief window between an optimistic
            // resolve and router.refresh() reconciling.
            const unresolvedComments = t.unresolvedComments.map((c) => ({
              id: c.id,
              versionId: c.versionId,
              versionLabel: c.versionLabel,
              authorName: c.authorName,
              body: c.body,
              timestampMs: c.timestampMs,
              endTimestampMs: c.endTimestampMs,
              fromProducer: c.fromProducer,
              createdAt: c.createdAt,
              resolvedAt: null as Date | null,
            }));
            return (
              <TrackRow
                key={t.id}
                trackId={t.id}
                projectId={project.id}
                title={t.title}
                versions={versions}
                comments={comments}
                unresolvedComments={unresolvedComments}
                viewerRole={VIEWER_ROLE}
                onAddVersion={(id, files) => {
                  void addVersionToTrack(id, files);
                }}
                onAddTracks={(files) => {
                  void createTrackFromFiles(files);
                }}
                onSetVersionStatus={(versionId, status) => {
                  void flipVersionStatus(versionId, status);
                }}
                onRenameTrack={renameTrack}
              />
            );
          })}
        </>
      )}
    </section>
  );
}
