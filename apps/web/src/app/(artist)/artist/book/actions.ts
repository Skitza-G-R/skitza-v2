"use server";

import { auth } from "@clerk/nextjs/server";
import { TRPCError } from "@trpc/server";
import { revalidatePath } from "next/cache";

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
  startsAt: string;
  projectId: string;
  purchaseId: string;
  sessionAllowanceId: string;
  operationKey: string;
}): Promise<
  { ok: true; id: string; status: "pending_approval" | "confirmed" } | { ok: false; error: string }
> {
  const { userId } = await auth();
  if (!userId) return { ok: false, error: "Not signed in" };

  const caller = appRouter.createCaller({ userId });
  try {
    const result = await caller.artist.book.confirm({
      ...input,
      startsAt: new Date(input.startsAt),
    });
    revalidatePath("/artist/sessions");
    return { ok: true, id: result.id, status: result.status };
  } catch (e) {
    if (e instanceof TRPCError) return { ok: false, error: e.message };
    return { ok: false, error: "Could not confirm booking" };
  }
}

export async function rescheduleBookingAction(input: {
  id: string;
  startsAt: string;
  operationKey: string;
}): Promise<
  | {
      ok: true;
      id: string;
      status: "pending_approval" | "confirmed";
      replacedBookingId: string;
    }
  | { ok: false; error: string }
> {
  const { userId } = await auth();
  if (!userId) return { ok: false, error: "Not signed in" };

  const caller = appRouter.createCaller({ userId });
  try {
    const result = await caller.artist.book.reschedule({
      ...input,
      startsAt: new Date(input.startsAt),
    });
    revalidatePath("/artist/sessions");
    revalidatePath(`/artist/sessions/${input.id}`);
    return { ok: true, ...result };
  } catch (error) {
    if (error instanceof TRPCError) return { ok: false, error: error.message };
    return { ok: false, error: "Could not reschedule this session" };
  }
}
