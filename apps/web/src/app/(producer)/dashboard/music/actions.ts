"use server";

import { auth } from "~/server/auth/clerk-identity";
import { TRPCError } from "@trpc/server";
import { revalidatePath } from "next/cache";
import { ZodError } from "zod";

import { appRouter } from "~/server/trpc/routers/_app";

export type MusicManagementActionResult = { ok: true } | { ok: false; error: string };

// SK-305. Structurally the same shape SongPage declares as
// MusicL3LyricsActionResult. Declared locally rather than imported, the way
// MusicL3ActionResult already is on both sides, so a "use server" module
// never reaches into a client component for a type.
export type MusicLyricsActionResult =
  | {
      ok: true;
      lyrics: string | null;
      lyricsUpdatedAtIso: string;
      lyricsUpdatedBy: "producer" | "artist";
    }
  | {
      ok: false;
      reason: "stale";
      lyrics: string | null;
      lyricsUpdatedAtIso: string | null;
      lyricsUpdatedBy: "producer" | "artist" | null;
    }
  | { ok: false; reason: "error"; error: string };

export type MusicAudioDeletionActionResult =
  | {
      ok: true;
      nextPlaybackVersionId: string | null;
      removedPortfolioEntry: boolean;
      disabledPublicLink: boolean;
    }
  | { ok: false; error: string };

async function callerOrError(): Promise<
  { ok: true; caller: ReturnType<typeof appRouter.createCaller> } | { ok: false; error: string }
> {
  const { userId } = await auth();
  if (!userId) return { ok: false, error: "Please sign in to continue." };
  return { ok: true, caller: appRouter.createCaller({ userId }) };
}

function toMessage(error: unknown): string {
  if (error instanceof ZodError) return error.issues[0]?.message ?? "Invalid input.";
  if (error instanceof TRPCError) {
    if (error.code === "UNAUTHORIZED") return "Please sign in to continue.";
    if (error.code === "NOT_FOUND") return "Song or version not found.";
    if (
      error.code === "BAD_REQUEST" ||
      error.code === "PRECONDITION_FAILED" ||
      error.code === "CONFLICT"
    ) {
      return error.message;
    }
    return "The change could not be completed safely. Please try again.";
  }
  return error instanceof Error ? error.message : "Something went wrong. Please try again.";
}

function revalidateMusic(projectId: string, versionId?: string): void {
  revalidatePath("/dashboard/music");
  revalidatePath(`/dashboard/music/project/${projectId}`);
  revalidatePath(`/dashboard/clients-projects/${projectId}`);
  if (versionId) revalidatePath(`/dashboard/music/${versionId}`);
}

export async function renameMusicSong(input: {
  projectId: string;
  trackId: string;
  versionId?: string;
  title: string;
}): Promise<MusicManagementActionResult> {
  const context = await callerOrError();
  if (!context.ok) return context;
  try {
    await context.caller.project.updateTrackTitle({
      projectId: input.projectId,
      trackId: input.trackId,
      title: input.title,
    });
    revalidateMusic(input.projectId, input.versionId);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: toMessage(error) };
  }
}

export async function editMusicSongArtist(input: {
  projectId: string;
  trackId: string;
  versionId?: string;
  artist: string | null;
}): Promise<MusicManagementActionResult> {
  const context = await callerOrError();
  if (!context.ok) return context;
  try {
    await context.caller.project.updateTrackArtist({
      trackId: input.trackId,
      artist: input.artist,
    });
    revalidateMusic(input.projectId, input.versionId);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: toMessage(error) };
  }
}

export async function setMusicSongArchived(input: {
  projectId: string;
  trackId: string;
  versionId?: string;
  archived: boolean;
}): Promise<MusicManagementActionResult> {
  const context = await callerOrError();
  if (!context.ok) return context;
  try {
    await context.caller.project.setTrackArchived({
      trackId: input.trackId,
      archived: input.archived,
    });
    revalidateMusic(input.projectId, input.versionId);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: toMessage(error) };
  }
}

export async function markMusicSongReleased(input: {
  projectId: string;
  trackId: string;
  versionId?: string;
}): Promise<MusicManagementActionResult> {
  const context = await callerOrError();
  if (!context.ok) return context;
  try {
    await context.caller.project.markTrackReleased({
      trackId: input.trackId,
      confirmation: "MARK_SONG_RELEASED",
    });
    revalidateMusic(input.projectId, input.versionId);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: toMessage(error) };
  }
}

export async function renameMusicVersion(input: {
  projectId: string;
  versionId: string;
  label: string;
}): Promise<MusicManagementActionResult> {
  const context = await callerOrError();
  if (!context.ok) return context;
  try {
    await context.caller.project.updateVersionLabel({
      projectId: input.projectId,
      versionId: input.versionId,
      label: input.label,
    });
    revalidateMusic(input.projectId, input.versionId);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: toMessage(error) };
  }
}

export async function deleteMusicVersionAudio(input: {
  projectId: string;
  versionId: string;
  operationKey: string;
}): Promise<MusicAudioDeletionActionResult> {
  const context = await callerOrError();
  if (!context.ok) return context;
  try {
    const result = await context.caller.project.permanentlyDeleteVersionAudio({
      versionId: input.versionId,
      operationKey: input.operationKey,
      confirmation: "DELETE_STORED_AUDIO",
    });
    return {
      ok: true,
      nextPlaybackVersionId: result.nextPlaybackVersionId,
      removedPortfolioEntry: result.removedPortfolioEntry,
      disabledPublicLink: result.disabledPublicLink,
    };
  } catch (error) {
    return { ok: false, error: toMessage(error) };
  } finally {
    // The database tombstone commits before storage reconciliation. Refresh
    // even when R2 asks for a retry so playback and history reflect that
    // durable read revocation immediately.
    revalidateMusic(input.projectId, input.versionId);
  }
}

export async function deleteMusicVersion(input: {
  projectId: string;
  versionId: string;
}): Promise<MusicManagementActionResult> {
  const context = await callerOrError();
  if (!context.ok) return context;
  try {
    await context.caller.project.permanentlyDeleteSongVersion({
      versionId: input.versionId,
      operationKey: input.versionId,
      confirmation: "DELETE_VERSION",
    });
    return { ok: true };
  } catch (error) {
    return { ok: false, error: toMessage(error) };
  } finally {
    revalidateMusic(input.projectId, input.versionId);
  }
}

export async function deleteMusicSong(input: {
  projectId: string;
  trackId: string;
}): Promise<MusicManagementActionResult> {
  const context = await callerOrError();
  if (!context.ok) return context;
  try {
    await context.caller.project.permanentlyDeleteSong({
      trackId: input.trackId,
      operationKey: input.trackId,
      confirmation: "DELETE_SONG",
    });
    return { ok: true };
  } catch (error) {
    return { ok: false, error: toMessage(error) };
  } finally {
    revalidateMusic(input.projectId);
  }
}

// SK-305. Lyrics are one sheet per song, and the artist can write it too, so
// `expectedUpdatedAtIso` is the stamp the page loaded and the whole clash
// guard. A `stale` answer is a real outcome, not a thrown error — it comes
// back untouched so the dialog can show the other side's words next to the
// ones still in the textarea.
export async function saveMusicSongLyrics(input: {
  projectId: string;
  trackId: string;
  versionId?: string;
  lyrics: string | null;
  expectedUpdatedAtIso: string | null;
}): Promise<MusicLyricsActionResult> {
  const context = await callerOrError();
  if (!context.ok) return { ok: false, reason: "error", error: context.error };
  try {
    const result = await context.caller.project.setSongLyrics({
      projectId: input.projectId,
      trackId: input.trackId,
      lyrics: input.lyrics,
      expectedUpdatedAtIso: input.expectedUpdatedAtIso,
    });
    // Only a save that actually landed changes what the server should re-render.
    if (result.ok) revalidateMusic(input.projectId, input.versionId);
    return result;
  } catch (error) {
    return { ok: false, reason: "error", error: toMessage(error) };
  }
}
