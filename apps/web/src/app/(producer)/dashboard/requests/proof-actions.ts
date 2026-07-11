"use server";

import { auth } from "@clerk/nextjs/server";
import { TRPCError } from "@trpc/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { appRouter } from "~/server/trpc/routers/_app";

export type PaymentProofActionResult =
  | {
      ok: true;
      finalPaid?: boolean;
      depositPaid?: boolean;
    }
  | { ok: false; error: string };

const proofDecisionInput = z.object({
  proofId: z.string().uuid(),
});

function revalidateProofSurfaces(purchaseRequestId: string) {
  revalidatePath("/dashboard");
  revalidatePath("/dashboard", "layout");
  revalidatePath("/dashboard/requests");
  revalidatePath("/dashboard/requests", "layout");
  revalidatePath(`/dashboard/requests/${purchaseRequestId}`);
  revalidatePath("/artist", "layout");
}

function errorMessage(error: unknown): string {
  if (error instanceof z.ZodError) return "This payment proof link is invalid.";
  if (error instanceof TRPCError) {
    if (error.code === "UNAUTHORIZED") return "Please sign in to continue.";
    if (error.code === "NOT_FOUND" || error.code === "FORBIDDEN") {
      return "This payment proof is no longer available.";
    }
    if (error.code === "BAD_REQUEST" || error.code === "CONFLICT") {
      return error.message || "This proof changed. Refresh and try again.";
    }
  }
  return "Payment proof update failed. Refresh and try again.";
}

export async function confirmPaymentProof(input: { proofId: string }): Promise<PaymentProofActionResult> {
  try {
    const parsed = proofDecisionInput.parse(input);
    const { userId } = await auth();
    if (!userId) return { ok: false, error: "Please sign in to continue." };

    const caller = appRouter.createCaller({ userId });
    const result = await caller.producer.purchase.proofOfPayment.confirm({
      proofId: parsed.proofId,
    });
    revalidateProofSurfaces(result.purchaseRequestId);
    return {
      ok: true,
      finalPaid: result.finalPaid,
      depositPaid: result.depositPaid,
    };
  } catch (error) {
    return { ok: false, error: errorMessage(error) };
  }
}

export async function rejectPaymentProof(input: {
  proofId: string;
  note: string;
}): Promise<PaymentProofActionResult> {
  try {
    const parsed = proofDecisionInput
      .extend({ note: z.string().trim().min(1).max(2000) })
      .parse(input);
    const { userId } = await auth();
    if (!userId) return { ok: false, error: "Please sign in to continue." };

    const caller = appRouter.createCaller({ userId });
    const result = await caller.producer.purchase.proofOfPayment.reject({
      proofId: parsed.proofId,
      note: parsed.note,
    });
    revalidateProofSurfaces(result.purchaseRequestId);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: errorMessage(error) };
  }
}
