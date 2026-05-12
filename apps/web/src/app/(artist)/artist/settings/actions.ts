"use server";

import { auth } from "@clerk/nextjs/server";
import { TRPCError } from "@trpc/server";
import { revalidatePath } from "next/cache";

import { appRouter } from "~/server/trpc/routers/_app";

// Server action wrapping artist.disconnectProducer — same pattern as
// confirmBookingAction in artist/book/actions.ts. Returns a tagged
// discriminated union so the client component can branch on the
// typed error (BAD_REQUEST when active bookings block the disconnect,
// NOT_FOUND when the contact row no longer exists) without parsing
// exception types.
//
// `revalidatePath('/artist', 'layout')` flushes every artist route's
// RSC cache so the studio list (preloaded in /artist/layout.tsx)
// drops the archived studio on next render.
export async function disconnectProducerAction(input: {
  producerId: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const { userId } = await auth();
  if (!userId) return { ok: false, error: "Not signed in" };

  const caller = appRouter.createCaller({ userId });
  try {
    await caller.artist.disconnectProducer(input);
    revalidatePath("/artist", "layout");
    return { ok: true };
  } catch (e) {
    if (e instanceof TRPCError) return { ok: false, error: e.message };
    return { ok: false, error: "Could not disconnect — please try again." };
  }
}
