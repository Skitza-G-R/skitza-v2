import { auth } from "~/server/auth/clerk-identity";
import { redirect } from "next/navigation";

import type { UploadTrackModalProject } from "~/components/dashboard/song/upload-track-modal";
import { RuntimeScreenSafeViewWriter } from "~/components/runtime-state/runtime-screen-view";
import {
  type MusicLibraryProjectRow,
  type MusicLibraryRow,
} from "~/components/music/library-screen";
import { ProducerRuntimeSafeView } from "~/components/dashboard/runtime/producer-runtime-safe-view";
import { ProducerMusicLibrary } from "~/components/music/producer-music-library";
import { mapProducerMusicSafeScreen } from "~/lib/runtime-state/screen-view-mappers";
import { projectSongUploadHref } from "~/lib/clients/project-song-upload-href";
import { appRouter } from "~/server/trpc/routers/_app";

import {
  deleteMusicSong,
  editMusicSongArtist,
  markMusicSongReleased,
  renameMusicSong,
  setMusicSongArchived,
} from "./actions";

type PageProps = {
  searchParams?: Promise<{
    addSong?: string;
    upload?: string;
    projectId?: string;
  }>;
};

export default async function MusicPage({ searchParams }: PageProps) {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const [data, resolvedParams] = await Promise.all([
    appRouter.createCaller({ userId }).library.music.producerList(),
    searchParams,
  ]);
  const params = resolvedParams ?? {};

  if (params.addSong === "1" && data.uploadableProjects.length === 0) {
    redirect("/dashboard/clients-projects");
  }

  const tracks: MusicLibraryRow[] = data.projects.flatMap((project) =>
    project.songs.map(
      (song): MusicLibraryRow => ({
        kind: "track",
        id: song.id,
        trackId: song.trackId,
        trackTitle: song.title,
        trackArtist: song.artist,
        archivedAtIso: song.archivedAt?.toISOString() ?? null,
        releasedAtIso: song.releasedAt?.toISOString() ?? null,
        audioDeletedAtIso:
          song.latestVersion === null
            ? (song.latestHistoryVersion?.audioDeletedAt?.toISOString() ?? null)
            : null,
        label: song.latestVersion?.label ?? song.latestHistoryVersion?.label ?? null,
        latestVersionId: song.latestVersion?.id ?? song.latestHistoryVersion?.id ?? null,
        projectId: project.id,
        projectTitle: project.title,
        projectLifecycleStatus: project.lifecycleStatus,
        clientName: project.partnerName,
        uploadedAtIso:
          (
            song.latestVersion?.uploadedAt ?? song.latestHistoryVersion?.uploadedAt
          )?.toISOString() ?? null,
        audioUrl: song.latestVersion?.audioUrl ?? null,
        durationMs: song.latestVersion?.durationMs ?? null,
        unreadComments: song.unreadComments,
        plays: song.plays,
        actionHref:
          project.lifecycleStatus === "active" &&
          song.purchaseLifecycleStatus === "active" &&
          song.archivedAt === null
            ? projectSongUploadHref(project.id, song.id)
            : null,
      }),
    ),
  );

  const projectRows: MusicLibraryProjectRow[] = data.projects.map((project) => {
    const latestUpload = project.songs.reduce<Date | null>((latest, song) => {
      const uploadedAt = song.latestVersion?.uploadedAt ?? song.latestHistoryVersion?.uploadedAt;
      return uploadedAt && (!latest || uploadedAt > latest) ? uploadedAt : latest;
    }, null);
    return {
      id: project.id,
      title: project.title,
      artistLabel: project.partnerName ?? "Unknown artist",
      visibleSpaceCount: project.songs.length,
      playableTrackCount: project.songs.filter((song) => song.latestVersion?.audioUrl).length,
      projectLifecycleStatus: project.lifecycleStatus,
      latestTrackUploadedAtIso: latestUpload?.toISOString() ?? null,
    };
  });

  const uploadProjects: UploadTrackModalProject[] = data.uploadableProjects.map((project) => ({
    id: project.id,
    title: project.title,
    clientName: project.partnerName,
    canCreateNewSong: project.emptySlots.length > 0,
    tracks: project.songs
      .filter((song) => song.purchaseLifecycleStatus === "active" && song.archivedAt === null)
      .map((song) => ({
        id: song.trackId,
        title: song.title,
        versionCount: song.versionCount,
        publicExposure: song.publicExposure,
      })),
  }));

  return (
    <div className="relative isolate">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[360px] bg-gradient-to-b from-[rgb(var(--brand-primary)/0.10)] via-[rgb(var(--bg-background))] to-[rgb(var(--bg-background))]"
      />
      <div className="mx-auto max-w-[1180px] px-4 pt-6 pb-24 sm:px-7 sm:pt-8">
        <ProducerRuntimeSafeView
          slot="producer.music.safe-view"
          data={{
            projectCount: projectRows.length,
            songCount: tracks.length,
            archivedSongCount: tracks.filter(
              (row) => row.kind !== "empty-slot" && row.archivedAtIso !== null,
            ).length,
          }}
        />
        <RuntimeScreenSafeViewWriter
          href="/dashboard/music"
          view={mapProducerMusicSafeScreen({
            projects: projectRows,
            tracks,
          })}
        />
        <ProducerMusicLibrary
          tracks={tracks}
          projectRows={projectRows}
          uploadProjects={uploadProjects}
          initialUploadOpen={params.upload === "1" || params.addSong === "1"}
          {...(params.projectId ? { initialProjectId: params.projectId } : {})}
          renameSong={renameMusicSong}
          editArtist={editMusicSongArtist}
          setArchived={setMusicSongArchived}
          markReleased={markMusicSongReleased}
          deleteSong={deleteMusicSong}
        />
      </div>
    </div>
  );
}
