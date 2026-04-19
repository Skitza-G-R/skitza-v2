import { auth } from "@clerk/nextjs/server";
import { notFound } from "next/navigation";
import { TRPCError } from "@trpc/server";

import { appRouter } from "~/server/trpc/routers/_app";
import { NowPlaying } from "./now-playing";

type PageProps = { params: Promise<{ projectId: string }> };

// Server component — resolves the project detail via the tRPC caller,
// bridges NOT_FOUND into Next's notFound() so the user sees the 404
// page instead of a stack trace. The artist layout has already gated
// on sign-in + role, so the auth() check here is defense-in-depth
// (matches the music index page pattern).
export default async function ProjectPage({ params }: PageProps) {
  const { projectId } = await params;
  const { userId } = await auth();
  if (!userId) return null;

  const caller = appRouter.createCaller({ userId });
  try {
    const data = await caller.artist.music.project({ projectId });
    return <NowPlaying data={data} />;
  } catch (e) {
    if (e instanceof TRPCError && e.code === "NOT_FOUND") {
      notFound();
    }
    throw e;
  }
}
