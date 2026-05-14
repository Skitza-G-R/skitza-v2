"use server";

import { auth } from "@clerk/nextjs/server";
import { TRPCError } from "@trpc/server";

import { appRouter } from "~/server/trpc/routers/_app";

// Server action wrapping the artist.book.confirm mutation. The client
// component calls this directly on submit so we don't have to wire a
// tRPC client into a bottom-sheet confirmation UI.
//
// Returns a tagged-discriminated shape so the client can branch on
// success vs. a typed error (wrong studio → NOT_FOUND, race →
// CONFLICT) without having to parse the exception type.
export async function confirmBookingAction(input: {
  producerId: string;
  date: string;
  block: "morning" | "evening";
  startMin: number;
  durationMin: number;
  projectId: string | null;
  productId: string | null;
  existingProjectId?: string;
}): Promise<{ ok: true; bookingId: string } | { ok: false; error: string }> {
  const { userId } = await auth();
  if (!userId) return { ok: false, error: "Not signed in" };

  const caller = appRouter.createCaller({ userId });
  try {
    const result = await caller.artist.book.confirm(input);
    return { ok: true, bookingId: result.id };
  } catch (e) {
    if (e instanceof TRPCError) return { ok: false, error: e.message };
    return { ok: false, error: "Could not confirm booking" };
  }
}
