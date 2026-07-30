import { auth } from "@clerk/nextjs/server";
import { notFound, redirect } from "next/navigation";

import { projectSongWorkspaceHref } from "~/lib/clients/project-song-workspace-href";
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

  const songBelongsToProject = data.tracks.some((track) => track.id === songId);
  if (!songBelongsToProject) {
    notFound();
  }

  redirect(
    projectSongWorkspaceHref(id, songId, {
      upload: query.upload === "1",
    }),
  );
}
