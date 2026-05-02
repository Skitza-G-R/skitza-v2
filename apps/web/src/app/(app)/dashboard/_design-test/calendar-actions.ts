"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@clerk/nextjs/server";
import { TRPCError } from "@trpc/server";

import { appRouter } from "~/server/trpc/routers/_app";

import type { AvailabilityBlock } from "./availability-shape";

// Server actions for the design-test Calendar tab's Availability
// view. Wires the "Save changes" button to the booking router's
// availability.setWeek (atomic week replace).
//
// Session length is set per-product (different per package), so it
// no longer roundtrips through this action — the producer-level
// defaultSessionMin is unused by the booking flow itself and just
// served as a starting value for new-product creation.

export type UpdateAvailabilityInput = {
  blocks: AvailabilityBlock[];
};

export type UpdateAvailabilityResult =
  | { ok: true }
  | { ok: false; error: string };

export async function updateAvailability(
  input: UpdateAvailabilityInput,
): Promise<UpdateAvailabilityResult> {
  const { userId } = await auth();
  if (!userId) return { ok: false, error: "Please sign in to continue." };

  try {
    const caller = appRouter.createCaller({ userId });
    await caller.booking.availability.setWeek({ blocks: input.blocks });
    revalidatePath("/dashboard/booking");
    return { ok: true };
  } catch (err) {
    if (err instanceof TRPCError) {
      return { ok: false, error: err.message };
    }
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Couldn't save availability.",
    };
  }
}
