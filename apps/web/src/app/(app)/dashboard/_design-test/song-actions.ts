"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@clerk/nextjs/server";

import { appRouter } from "~/server/trpc/routers/_app";

// Server actions for the design-test Song Page. Wires the comment
// input to the new `library.addComment` producer mutation. Mirrors
// the pattern from quick-note-actions.ts: resolve auth via auth(),
// dispatch through producerProcedure, revalidate the page on
// success.

export type AddCommentResult =
  | { ok: true; id: string }
  | { ok: false; error: string };

export async function addSongComment(input: {
  trackVersionId: string;
  timeMs: number;
  body: string;
}): Promise<AddCommentResult> {
  const { userId } = await auth();
  if (!userId) return { ok: false, error: "Please sign in to continue." };
  if (!input.body.trim()) {
    return { ok: false, error: "Comment can't be empty." };
  }
  try {
    const caller = appRouter.createCaller({ userId });
    const result = await caller.library.addComment({
      trackVersionId: input.trackVersionId,
      timeMs: Math.max(0, Math.floor(input.timeMs)),
      body: input.body.trim(),
    });
    revalidatePath(`/dashboard/music/${input.trackVersionId}`);
    return { ok: true, id: result.id };
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof Error ? err.message : "Couldn't post the comment.",
    };
  }
}
