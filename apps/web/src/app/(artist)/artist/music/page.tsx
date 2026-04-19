import { auth } from "@clerk/nextjs/server";

import { ProjectCard } from "~/components/artist/music/project-card";
import { appRouter } from "~/server/trpc/routers/_app";

// Server Component. Reads the entire projects list in one tRPC call
// (artist.music.projects) and renders a vertical list. The artist
// layout already gates non-signed-in traffic, so the auth() check
// here is defense-in-depth (matches the home page pattern).
export default async function MusicPage() {
  const { userId } = await auth();
  if (!userId) return null;

  const caller = appRouter.createCaller({ userId });
  const { projects } = await caller.artist.music.projects();

  if (projects.length === 0) {
    return (
      <div className="py-12 text-center">
        <p className="text-sm text-[rgb(var(--fg-secondary))]">
          No tracks yet. Your producer will upload your mixes here once
          work begins.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <h1 className="sr-only">Music</h1>
      {projects.map((p) => (
        <ProjectCard key={p.projectId} project={p} />
      ))}
    </div>
  );
}
