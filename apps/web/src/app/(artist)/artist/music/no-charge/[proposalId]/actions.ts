"use server";

import { auth } from "@clerk/nextjs/server";
import { TRPCError } from "@trpc/server";
import { revalidatePath } from "next/cache";

import { appRouter } from "~/server/trpc/routers/_app";

type ActionResult =
  | { ok: true; data: { projectId: string; trackId: string; purchaseId: string } }
  | { ok: false; error: string };

function actionError(error: unknown): string {
  if (error instanceof TRPCError) {
    if (error.code === "UNAUTHORIZED") return "Please sign in to continue.";
    if (error.code === "NOT_FOUND" || error.code === "FORBIDDEN") {
      return "This no charge proposal is not available to your account.";
    }
    if (error.code === "CONFLICT" || error.code === "PRECONDITION_FAILED") {
      return error.message;
    }
  }
  return "Couldn't accept this agreement. Refresh and try again.";
}

export async function acceptNoChargeSongProposalAction(input: {
  proposalToken: string;
  expectedSnapshotDigest: string;
  agreementAccepted: true;
}): Promise<ActionResult> {
  const { userId } = await auth();
  if (!userId) return { ok: false, error: "Please sign in to continue." };

  try {
    const result = await appRouter.createCaller({ userId }).project.noChargeProposal.accept(input);
    revalidatePath("/artist/music");
    revalidatePath(`/artist/music/${result.projectId}`);
    revalidatePath("/dashboard/music");
    revalidatePath(`/dashboard/clients-projects/${result.projectId}`);
    return {
      ok: true,
      data: {
        projectId: result.projectId,
        trackId: result.trackId,
        purchaseId: result.purchaseId,
      },
    };
  } catch (error) {
    return { ok: false, error: actionError(error) };
  }
}
