"use server";

import { auth } from "@clerk/nextjs/server";
import { TRPCError } from "@trpc/server";
import { revalidatePath } from "next/cache";

import { appRouter } from "~/server/trpc/routers/_app";

// SK-20 — dismiss handler for the "you got paid" banner.
//
// Server action wrapper around booking.acknowledgePayment. Stamps
// producer_acknowledged_at = now() on the booking row, then revalidates
// /dashboard so both the banner and the activity feed's unread dot
// reflect the change on the next render. Mirrors the createClientAction
// pattern from clients-projects/clients-actions.ts — Server Action is
// the project's canonical client→server channel; we don't have a tRPC
// react-query client wired up.

export type AcknowledgePaymentResult =
  | { ok: true }
  | { ok: false; error: string };

export async function acknowledgePaymentAction(input: {
  bookingId: string;
}): Promise<AcknowledgePaymentResult> {
  const { userId } = await auth();
  if (!userId) return { ok: false, error: "Please sign in to continue." };
  try {
    const caller = appRouter.createCaller({ userId });
    await caller.booking.acknowledgePayment({ bookingId: input.bookingId });
    revalidatePath("/dashboard");
    return { ok: true };
  } catch (err) {
    console.error("[payment-banner] acknowledgePayment failed", err);
    if (err instanceof TRPCError && err.code === "NOT_FOUND") {
      return { ok: false, error: "Payment not found." };
    }
    return { ok: false, error: "Couldn't dismiss — please try again." };
  }
}
