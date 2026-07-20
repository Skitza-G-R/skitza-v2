"use server";

import { auth } from "@clerk/nextjs/server";
import { TRPCError } from "@trpc/server";
import { revalidatePath } from "next/cache";

import { appRouter } from "~/server/trpc/routers/_app";

type ActionError = { ok: false; error: string };

function errorResult(error: unknown, fallback: string): ActionError {
  return { ok: false, error: error instanceof TRPCError ? error.message : fallback };
}

function refreshProofSurfaces(proofId: string, projectId?: string): void {
  revalidatePath("/dashboard", "layout");
  revalidatePath("/dashboard/payments", "layout");
  revalidatePath(`/dashboard/payments/${proofId}`);
  if (projectId) revalidatePath(`/dashboard/clients-projects/${projectId}`, "layout");
  revalidatePath("/artist", "layout");
}

export async function confirmPaymentProofAction(input: { proofId: string }) {
  const { userId } = await auth();
  if (!userId) return { ok: false as const, error: "Not signed in" };
  try {
    const result = await appRouter
      .createCaller({ userId })
      .producer.purchase.proofOfPayment.confirm(input);
    refreshProofSurfaces(input.proofId, result.projectId);
    return { ok: true as const, result };
  } catch (error) {
    return errorResult(error, "Could not confirm this payment proof. Refresh and try again.");
  }
}

export async function rejectPaymentProofAction(input: { proofId: string; note: string }) {
  const { userId } = await auth();
  if (!userId) return { ok: false as const, error: "Not signed in" };
  try {
    const result = await appRouter
      .createCaller({ userId })
      .producer.purchase.proofOfPayment.reject(input);
    refreshProofSurfaces(input.proofId, result.projectId);
    return { ok: true as const, result };
  } catch (error) {
    return errorResult(error, "Could not reject this payment proof. Refresh and try again.");
  }
}
