"use server";

import { TRPCError } from "@trpc/server";
import { ZodError } from "zod";
import { auth } from "@clerk/nextjs/server";
import { appRouter } from "~/server/trpc/routers/_app";

// Shape returned by `artist.music.addComment` — shared with the client
// so optimistic-append can match what comes back from the server.
export type AddedComment = {
  id: string;
  versionId: string;
  timeMs: number;
  body: string;
  fromProducer: boolean;
  authorName: string;
  createdAt: Date;
  resolvedAt: Date | null;
};

export type AddCommentResult =
  | { ok: true; comment: AddedComment }
  | { ok: false; error: string };

function toMessage(err: unknown): string {
  if (err instanceof ZodError) {
    const first = err.issues[0];
    return first?.message ?? "Invalid input.";
  }
  if (err instanceof TRPCError) {
    switch (err.code) {
      case "NOT_FOUND":
        return "This project isn't available.";
      default:
        return err.message || "Something went wrong. Please try again.";
    }
  }
  return err instanceof Error ? err.message : "Something went wrong.";
}

// Server action that wraps the `artist.music.addComment` mutation for
// the Now Playing client. Returns a shaped result the client can feed
// directly into an optimistic append (on success) or surface as an
// inline error (on failure).
export async function submitTimestampedComment(input: {
  trackVersionId: string;
  timeMs: number;
  body: string;
}): Promise<AddCommentResult> {
  try {
    const { userId } = await auth();
    if (!userId) return { ok: false, error: "Please sign in." };
    const caller = appRouter.createCaller({ userId });
    const comment = await caller.artist.music.addComment(input);
    return { ok: true, comment };
  } catch (err) {
    return { ok: false, error: toMessage(err) };
  }
}
