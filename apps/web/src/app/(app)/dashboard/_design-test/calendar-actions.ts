"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@clerk/nextjs/server";
import { TRPCError } from "@trpc/server";

import { appRouter } from "~/server/trpc/routers/_app";

import type { AvailabilityBlock } from "./availability-shape";

// Server actions for the design-test Calendar tab's Availability
// view. Wires the "Save changes" button to the booking router's
// availability.setWeek (atomic week replace) + availability.updateSettings
// (defaultSessionMin only — the editor doesn't expose autoConfirm
// or cancellation policy in this round).
//
// The two writes happen sequentially. setWeek goes first because
// its Zod validation (block overlap, start<end) is the more likely
// failure path. If it fails the session length is left untouched —
// retry-friendly.

export type UpdateAvailabilityInput = {
  blocks: AvailabilityBlock[];
  defaultSessionMin: number;
};

export type UpdateAvailabilityResult =
  | { ok: true }
  | { ok: false; error: string };

export async function updateAvailability(
  input: UpdateAvailabilityInput,
): Promise<UpdateAvailabilityResult> {
  const { userId } = await auth();
  if (!userId) return { ok: false, error: "Please sign in to continue." };

  const blocks = input.blocks;
  const defaultSessionMin = Math.max(15, Math.min(8 * 60, Math.floor(input.defaultSessionMin)));

  try {
    const caller = appRouter.createCaller({ userId });
    await caller.booking.availability.setWeek({ blocks });
    await caller.booking.availability.updateSettings({ defaultSessionMin });
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
