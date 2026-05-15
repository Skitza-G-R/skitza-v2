import { auth } from "@clerk/nextjs/server";
import { TRPCError } from "@trpc/server";
import { notFound, redirect } from "next/navigation";

import { appRouter } from "~/server/trpc/routers/_app";

import { ProjectPage, type ProjectPageData } from "./project-page";

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
    data = await caller.producer.music.project({ projectId });
  } catch (e) {
    if (e instanceof TRPCError && e.code === "NOT_FOUND") notFound();
    throw e;
  }

  // Convert Dates → ISO strings for the client boundary.
  const wire: ProjectPageData = {
    project: {
      id: data.project.id,
      title: data.project.title,
      clientName: data.project.clientName,
      createdAtIso: data.project.createdAt.toISOString(),
    },
    tracks: data.tracks.map((t) => ({
      id: t.id,
      trackId: t.trackId,
      title: t.title,
      artist: t.artist,
      versionLabel: t.versionLabel,
      audioUrl: t.audioUrl,
      durationMs: t.durationMs,
      uploadedAtIso: t.uploadedAt.toISOString(),
      unreadComments: t.unreadComments,
      plays: t.plays,
    })),
  };

  return <ProjectPage data={wire} />;
}
