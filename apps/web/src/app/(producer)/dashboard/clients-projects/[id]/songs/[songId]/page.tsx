import { auth } from "~/server/auth/clerk-identity";
import { notFound, redirect } from "next/navigation";

import { projectSongUploadHref } from "~/lib/clients/project-song-upload-href";
import { appRouter } from "~/server/trpc/routers/_app";

type PageProps = {
  params: Promise<{ id: string; songId: string }>;
  searchParams?: Promise<{ upload?: string }>;
};

export default async function LegacySongDetail({ params, searchParams }: PageProps) {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const { id, songId } = await params;
  const query = (await searchParams) ?? {};
  const caller = appRouter.createCaller({ userId });

  let data;
  try {
    data = await caller.project.detail({ id });
  } catch {
    notFound();
  }

  const track = data.tracks.find((candidate) => candidate.id === songId);
  if (!track) {
    notFound();
  }

  if (query.upload === "1") {
    redirect(projectSongUploadHref(id, songId));
  }

  const songVersions = data.versions.filter((version) => version.trackId === track.id);
  const playable = songVersions.find(
    (version) => version.audioDeletedAt === null && version.audioUrl !== null,
  );
  const historical = songVersions.find(
    (version) => version.audioUrl !== null || version.audioDeletedAt !== null,
  );
  const detailVersion = playable ?? historical;

  if (detailVersion) {
    redirect(
      `/dashboard/music/${encodeURIComponent(detailVersion.id)}?from=${encodeURIComponent(id)}`,
    );
  }

  redirect(`/dashboard/clients-projects/${encodeURIComponent(id)}`);
}
