"use client";

import { MusicLibraryScreen, type MusicLibraryRow } from "~/components/music/library-screen";
import type { VersionDeliveryState } from "~/components/music/delivery-state";
import { SongPage, type MusicL3ActionResult } from "~/components/music/song-page";

function succeed(): Promise<MusicL3ActionResult> {
  return Promise.resolve({ ok: true });
}

function delivery(
  permission: VersionDeliveryState["permission"],
  purchaseId: string,
): VersionDeliveryState {
  return {
    purchaseId,
    permission,
    fullyPaid: permission === "purchase_fully_paid",
    remainingCents: permission === "purchase_fully_paid" ? 0 : 60_000,
    currency: "ILS",
    overdue: false,
    totalCents: 120_000,
  };
}

export function Sk8LibraryDevScreen({ tracks }: { tracks: MusicLibraryRow[] }) {
  return (
    <main id="main-content" tabIndex={-1} className="mx-auto max-w-[1400px] px-4 py-5 sm:px-6">
      <MusicLibraryScreen
        tracks={tracks}
        renameSong={succeed}
        editArtist={succeed}
        setArchived={succeed}
        markReleased={succeed}
      />
    </main>
  );
}

export function Sk8SongDevScreen({ archived }: { archived: boolean }) {
  return (
    <SongPage
      data={{
        track: {
          id: "track-sk8-live",
          title: archived ? "Slow Motion" : "After the Rain",
          artist: archived ? "Maya Cohen" : "Noya Halevi",
          projectId: "project-sk8-live",
          projectTitle: "After the Rain — Single",
          clientName: archived ? "Maya Cohen" : "Noya Halevi",
          archivedAtIso: archived ? "2026-07-10T10:00:00.000Z" : null,
          releasedAtIso: archived ? null : "2026-07-18T12:00:00.000Z",
          workflowStage: archived ? "mixing" : "done",
          projectLifecycleStatus: "active",
          artistApprovalLocked: true,
        },
        versions: [
          {
            id: "version-sk8-live-v3",
            label: "Final master",
            audioUrl: "/icon",
            audioDeletedAtIso: null,
            durationMs: 201_000,
            uploadedAtIso: "2026-07-18T09:30:00.000Z",
            producerMarkedFinalAtIso: "2026-07-18T10:00:00.000Z",
            artistApprovedAtIso: "2026-07-18T10:15:00.000Z",
            previouslyArtistApprovedAtIso: null,
            peaks: [0.18, 0.42, 0.68, 0.35, 0.82, 0.54, 0.27, 0.61],
            delivery: delivery("purchase_fully_paid", "purchase-sk8"),
          },
          {
            id: "version-sk8-deleted-v2",
            label: "v2 notes pass",
            audioUrl: null,
            audioDeletedAtIso: "2026-07-18T11:00:00.000Z",
            durationMs: null,
            uploadedAtIso: "2026-07-16T14:00:00.000Z",
            producerMarkedFinalAtIso: null,
            artistApprovedAtIso: null,
            previouslyArtistApprovedAtIso: null,
            peaks: null,
            delivery: delivery("audio_deleted", "purchase-sk8"),
          },
        ],
        comments: [
          {
            id: "comment-sk8-1",
            versionId: "version-sk8-deleted-v2",
            timeMs: 42_000,
            body: "Keep the vocal texture from this pass.",
            fromProducer: false,
            authorName: "Noya Halevi",
            createdAtIso: "2026-07-16T15:30:00.000Z",
            resolvedAtIso: null,
          },
        ],
        selectedVersionId: "version-sk8-live-v3",
      }}
      actions={{
        addComment: succeed,
        resolveComment: succeed,
        markVersionReady: succeed,
        reopenSong: succeed,
        renameSong: succeed,
        editArtist: succeed,
        setArchived: succeed,
        markReleased: succeed,
        renameVersion: succeed,
        deleteVersionAudio: () =>
          Promise.resolve({
            ok: true,
            nextPlaybackVersionId: null,
            removedPortfolioEntry: true,
            disabledPublicLink: true,
          }),
      }}
    />
  );
}

export function Sk94ApprovalDevScreen({
  role,
  state,
}: {
  role: "producer" | "artist";
  state: "ready" | "approved" | "reopened";
}) {
  const ready = state === "ready" || state === "approved";
  const approved = state === "approved";
  return (
    <SongPage
      role={role}
      data={{
        track: {
          id: "track-sk94-preview",
          title: "Golden Hour",
          artist: "Noya Halevi",
          projectId: "project-sk94-preview",
          projectTitle: "Golden Hour — Single",
          clientName: role === "producer" ? "Noya Halevi" : "Studio Gili",
          archivedAtIso: null,
          releasedAtIso: null,
          workflowStage: "mastering",
          projectLifecycleStatus: "active",
          artistApprovalLocked: approved,
        },
        versions: [
          {
            id: "version-sk94-final",
            label: "Final master v4",
            audioUrl: "/icon",
            audioDeletedAtIso: null,
            durationMs: 218_000,
            uploadedAtIso: "2026-07-20T09:30:00.000Z",
            producerMarkedFinalAtIso: ready ? "2026-07-20T10:00:00.000Z" : null,
            artistApprovedAtIso: approved ? "2026-07-20T10:15:00.000Z" : null,
            previouslyArtistApprovedAtIso: state === "reopened" ? "2026-07-19T16:20:00.000Z" : null,
            peaks: [0.24, 0.51, 0.73, 0.38, 0.88, 0.61, 0.32, 0.67],
            delivery: delivery("payment_required", "purchase-sk94"),
          },
          {
            id: "version-sk94-v3",
            label: "Mix v3",
            audioUrl: "/icon",
            audioDeletedAtIso: null,
            durationMs: 218_000,
            uploadedAtIso: "2026-07-19T14:00:00.000Z",
            producerMarkedFinalAtIso: null,
            artistApprovedAtIso: null,
            previouslyArtistApprovedAtIso: null,
            peaks: [0.16, 0.37, 0.62, 0.44, 0.76, 0.48, 0.29, 0.58],
            delivery: delivery("payment_required", "purchase-sk94"),
          },
        ],
        comments: [],
        selectedVersionId: "version-sk94-final",
      }}
      actions={{
        addComment: succeed,
        resolveComment: succeed,
        markVersionReady: succeed,
        approveVersion: succeed,
        reopenSong: succeed,
        ...(role === "producer" ? { setDownloadOverride: succeed } : {}),
      }}
    />
  );
}
