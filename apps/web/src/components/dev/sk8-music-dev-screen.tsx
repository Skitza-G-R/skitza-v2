"use client";

import { MusicLibraryScreen, type MusicLibraryRow } from "~/components/music/library-screen";
import { SongPage, type MusicL3ActionResult } from "~/components/music/song-page";

function succeed(): Promise<MusicL3ActionResult> {
  return Promise.resolve({ ok: true });
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
        },
        versions: [
          {
            id: "version-sk8-live-v3",
            label: "Final master",
            audioUrl: "/icon",
            audioDeletedAtIso: null,
            durationMs: 201_000,
            uploadedAtIso: "2026-07-18T09:30:00.000Z",
            approvedAtIso: "2026-07-18T10:15:00.000Z",
            peaks: [0.18, 0.42, 0.68, 0.35, 0.82, 0.54, 0.27, 0.61],
          },
          {
            id: "version-sk8-deleted-v2",
            label: "v2 notes pass",
            audioUrl: null,
            audioDeletedAtIso: "2026-07-18T11:00:00.000Z",
            durationMs: null,
            uploadedAtIso: "2026-07-16T14:00:00.000Z",
            approvedAtIso: null,
            peaks: null,
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
        approveVersion: succeed,
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
