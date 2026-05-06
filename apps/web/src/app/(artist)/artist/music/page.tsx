import { auth } from "@clerk/nextjs/server";

import { MusicLibraryClient } from "~/components/artist/music/music-library-client";
import { appRouter } from "~/server/trpc/routers/_app";

// Server Component. Reads the entire projects list in one tRPC call
// (artist.music.projects) plus the artist's studios list (powers the
// per-producer filter rail). The polished client component does
// in-memory filtering. The artist layout already gates non-signed-in
// traffic, so the auth() check here is defense-in-depth (matches the
// home page pattern).
export default async function MusicPage() {
  const { userId } = await auth();
  if (!userId) return null;

  const caller = appRouter.createCaller({ userId });
  const [{ projects }, { studios }] = await Promise.all([
    caller.artist.music.projects(),
    caller.artist.studios(),
  ]);

  return <MusicLibraryClient projects={projects} studios={studios} />;
}
