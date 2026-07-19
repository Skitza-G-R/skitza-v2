import { auth } from "@clerk/nextjs/server";
import { TRPCError } from "@trpc/server";
import { notFound, redirect } from "next/navigation";

import { appRouter } from "~/server/trpc/routers/_app";

import { ProjectPage, type ProjectPageData } from "~/components/music/project-page";

type PageProps = { params: Promise<{ projectId: string }> };

// L2 project page — sits between the Library and the Song.
//
// The producer lands here when they tap a project card in the Library
// (Projects mode), or when they hit the "back" button from a Song page.
// Resolves data via producer.music.project — producer-scoped on the
// server. NOT_FOUND surfaces as Next's notFound() (same convention the
// Song page uses) so we don't differentiate "doesn't exist" from "not
// yours" in the URL.
export default async function ProducerProjectPage({ params }: PageProps) {
  const { projectId } = await params;
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  // Validate UUID shape early — keeps the tRPC Zod layer from emitting
  // a generic BAD_REQUEST that we'd then bridge to a 500.
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      projectId,
    )
  ) {
    notFound();
  }

  const caller = appRouter.createCaller({ userId });
  let data;
  try {
    data = await caller.library.music.producerProject({ projectId });
  } catch (e) {
    if (e instanceof TRPCError && e.code === "NOT_FOUND") notFound();
    throw e;
  }

  // Convert Dates → ISO strings for the client boundary.
  const wire: ProjectPageData = {
    project: {
      id: data.id,
      title: data.title,
      clientName: data.partnerName,
      createdAtIso: data.createdAt.toISOString(),
      lifecycleStatus: data.lifecycleStatus,
    },
    tracks: [
      ...data.songs.map((song) => ({
        kind: "track" as const,
        id: song.id,
        trackId: song.trackId,
        title: song.title,
        artist: song.artist,
        versionLabel: song.latestVersion?.label ?? null,
        latestVersionId: song.latestVersion?.id ?? null,
        audioUrl: song.latestVersion?.audioUrl ?? null,
        durationMs: song.latestVersion?.durationMs ?? null,
        uploadedAtIso: song.latestVersion?.uploadedAt.toISOString() ?? null,
        unreadComments: song.unreadComments,
        plays: song.plays,
        actionHref:
          data.lifecycleStatus === "active" &&
          song.purchaseLifecycleStatus === "active"
            ? `/dashboard/clients-projects/${data.id}/songs/${song.id}?upload=1`
            : null,
      })),
      ...data.emptySlots.map((slot) => ({
        kind: "empty-slot" as const,
        id: slot.id,
        purchaseId: slot.purchaseId,
        slotIndex: slot.slotNumber,
        title: slot.title,
        actionHref:
          data.lifecycleStatus === "active"
            ? `/dashboard/music?addSong=1&projectId=${data.id}&purchaseId=${slot.purchaseId}&lockProject=1`
            : null,
      })),
    ],
  };

  return (
    <ProjectPage
      data={wire}
      {...(data.lifecycleStatus === "active"
        ? {
            producerActionHref: `/dashboard/music?addSong=1&projectId=${data.id}&lockProject=1`,
          }
        : {})}
    />
  );
}
