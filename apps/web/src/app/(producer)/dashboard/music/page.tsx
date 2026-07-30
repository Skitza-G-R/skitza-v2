import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

import type { AddSongProjectOption } from "~/components/dashboard/song/add-song-dialog";
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
  editMusicSongArtist,
  markMusicSongReleased,
  renameMusicSong,
  setMusicSongArchived,
} from "./actions";

type PageProps = {
  searchParams?: Promise<{
    addSong?: string;
    projectId?: string;
    purchaseId?: string;
    lockProject?: string;
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

  if (params.addSong === "1" && data.activeProjects.length === 0) {
    redirect("/dashboard/clients-projects?newProject=1");
  }

  const tracks: MusicLibraryRow[] = data.projects.flatMap((project) => [
    ...project.songs.map(
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
    ...project.emptySlots.map(
      (slot): MusicLibraryRow => ({
        kind: "empty-slot",
        id: slot.id,
        purchaseId: slot.purchaseId,
        slotIndex: slot.slotNumber,
        trackTitle: slot.title,
        projectId: project.id,
        projectTitle: project.title,
        projectLifecycleStatus: project.lifecycleStatus,
        clientName: project.partnerName,
        actionHref:
          project.lifecycleStatus === "active"
            ? `/dashboard/music?addSong=1&projectId=${project.id}&purchaseId=${slot.purchaseId}&lockProject=1`
            : null,
      }),
    ),
  ]);

  const projectRows: MusicLibraryProjectRow[] = data.projects.map((project) => {
    const latestUpload = project.songs.reduce<Date | null>((latest, song) => {
      const uploadedAt = song.latestVersion?.uploadedAt ?? song.latestHistoryVersion?.uploadedAt;
      return uploadedAt && (!latest || uploadedAt > latest) ? uploadedAt : latest;
    }, null);
    return {
      id: project.id,
      title: project.title,
      artistLabel: project.partnerName ?? "Unknown artist",
      visibleSpaceCount: project.visibleCount,
      playableTrackCount: project.songs.filter((song) => song.latestVersion?.audioUrl).length,
      projectLifecycleStatus: project.lifecycleStatus,
      latestTrackUploadedAtIso: latestUpload?.toISOString() ?? null,
    };
  });

  const addSongProjects: AddSongProjectOption[] = data.activeProjects.map((project) => ({
    id: project.id,
    title: project.title,
    clientName: project.partnerName,
    emptySlots: project.emptySlots.map((slot) => ({
      id: slot.id,
      purchaseId: slot.purchaseId,
      slotNumber: slot.slotNumber,
      label: slot.label,
    })),
    paidExtraProducts: project.paidExtraProducts.map((product) => ({ ...product })),
    noChargeAvailable: project.noChargeAvailable,
    noChargeUnavailableReason: project.noChargeUnavailableReason,
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
          addSongProjects={addSongProjects}
          initialAddSongOpen={params.addSong === "1"}
          lockInitialProject={params.lockProject === "1"}
          {...(params.projectId ? { initialProjectId: params.projectId } : {})}
          {...(params.purchaseId ? { initialPurchaseId: params.purchaseId } : {})}
          renameSong={renameMusicSong}
          editArtist={editMusicSongArtist}
          setArchived={setMusicSongArchived}
          markReleased={markMusicSongReleased}
        />
      </div>
    </div>
  );
}
