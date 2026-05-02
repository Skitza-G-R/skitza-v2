"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@clerk/nextjs/server";
import { TRPCError } from "@trpc/server";

import { appRouter } from "~/server/trpc/routers/_app";

import { validateNewSongInput, type NewSongInput } from "./create-validators";

// Server action for the design-test "Add Song" modal in Music Library.
// Creates a new track + an initial v1 version (audioUrl=null — the
// row is in "upload pending" state, matching the audio.completeMultipart
// flow that fills audioUrl on real upload). Real audio upload lives
// on the song page; this just spins up the placeholder so the song
// is visible in the library.
//
// Returns the new versionId so the modal can navigate straight into
// the song page (where the actual upload UI lives).

export type CreateSongResult =
  | { ok: true; trackId: string; versionId: string }
  | { ok: false; error: string };

export async function createSong(
  input: NewSongInput,
): Promise<CreateSongResult> {
  const { userId } = await auth();
  if (!userId) return { ok: false, error: "Please sign in to continue." };

  const localError = validateNewSongInput(input);
  if (localError) return { ok: false, error: localError };

  try {
    const caller = appRouter.createCaller({ userId });
    const track = await caller.project.addTrack({
      projectId: input.projectId,
      title: input.title.trim(),
    });
    const version = await caller.project.addVersion({
      trackId: track.id,
      label: "v1",
      audioUrl: null,
    });
    revalidatePath("/dashboard/music");
    return { ok: true, trackId: track.id, versionId: version.id };
  } catch (err) {
    if (err instanceof TRPCError) return { ok: false, error: err.message };
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Couldn't create song.",
    };
  }
}
