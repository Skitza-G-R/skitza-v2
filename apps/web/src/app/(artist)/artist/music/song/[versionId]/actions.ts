"use server";

import { auth } from "@clerk/nextjs/server";
import { TRPCError } from "@trpc/server";
import { revalidatePath } from "next/cache";
import { ZodError } from "zod";

import { appRouter } from "~/server/trpc/routers/_app";

// Artist-side L3 server actions — match the shape of the producer's
// /dashboard/music/[versionId]/actions.ts (same MusicL3ActionResult
// payload, same input shape) so the shared SongPage component can
// invoke them through the L3Actions prop without conditional logic.
//
// What's different:
//   - addComment routes to `artist.music.addComment` (gated by
//     client_contacts; tags fromProducer = false).
//   - resolveComment routes to `artist.music.resolveComment` (the
//     artist-side mirror of project.resolveComment).
//   - approveVersion is not exported. The shared SongPage's
//     L3Actions.approveVersion prop is optional, and the artist L3
//     hides the Approve button entirely (role="artist" gate inside
//     the component), so no callback is needed here.
//   - revalidatePath targets `/artist/music/song/<versionId>` so the
//     L3 route refreshes after mutation rather than the producer
//     dashboard path.

export type MusicL3ActionResult = { ok: true } | { ok: false; error: string };

function pathDetail(versionId: string): string {
  return `/artist/music/song/${versionId}`;
}

async function callerOrError(): Promise<
  | { ok: true; caller: ReturnType<typeof appRouter.createCaller> }
  | { ok: false; error: string }
> {
  const { userId } = await auth();
  if (!userId) return { ok: false, error: "Please sign in to continue." };
  return { ok: true, caller: appRouter.createCaller({ userId }) };
}

function toMessage(err: unknown): string {
  if (err instanceof ZodError) {
    const first = err.issues[0];
    if (first) {
      const field = first.path.join(".");
      return field ? `${field}: ${first.message}` : first.message;
    }
    return "Invalid input.";
  }
  if (err instanceof TRPCError) {
    switch (err.code) {
      case "UNAUTHORIZED":
        return "Please sign in to continue.";
      case "FORBIDDEN":
        return "You don't have access.";
      case "NOT_FOUND":
        return "Not found.";
      case "BAD_REQUEST":
        return err.message || "Invalid input.";
      default:
        return "Something went wrong. Please try again.";
    }
  }
  return err instanceof Error ? err.message : "Something went wrong.";
}

export async function l3AddComment(input: {
  versionId: string;
  body: string;
  timestampMs: number;
}): Promise<MusicL3ActionResult> {
  const c = await callerOrError();
  if (!c.ok) return c;
  try {
    // The artist procedure uses `trackVersionId` + `timeMs` field
    // names where the producer's uses `versionId` + `timestampMs`.
    // We map at the boundary so the shared SongPage can stay on the
    // producer-style L3Actions input shape.
    await c.caller.artist.music.addComment({
      trackVersionId: input.versionId,
      timeMs: input.timestampMs,
      body: input.body,
    });
    revalidatePath(pathDetail(input.versionId));
    return { ok: true };
  } catch (err) {
    return { ok: false, error: toMessage(err) };
  }
}

export async function l3ResolveComment(input: {
  versionId: string;
  id: string;
  resolved: boolean;
}): Promise<MusicL3ActionResult> {
  const c = await callerOrError();
  if (!c.ok) return c;
  try {
    await c.caller.artist.music.resolveComment({
      id: input.id,
      resolved: input.resolved,
    });
    revalidatePath(pathDetail(input.versionId));
    return { ok: true };
  } catch (err) {
    return { ok: false, error: toMessage(err) };
  }
}
