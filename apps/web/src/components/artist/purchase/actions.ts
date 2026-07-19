"use server";

import { auth } from "@clerk/nextjs/server";
import { TRPCError } from "@trpc/server";
import { revalidatePath } from "next/cache";

import { type PaymentPlanChoice } from "~/lib/purchase/request-helpers";
import { appRouter } from "~/server/trpc/routers/_app";

export type ProofContentType =
  | "image/jpeg"
  | "image/png"
  | "image/webp"
  | "image/heic"
  | "application/pdf";

type ActionError = { ok: false; error: string };

function errorResult(error: unknown, fallback: string): ActionError {
  return {
    ok: false,
    error: error instanceof TRPCError ? error.message : fallback,
  };
}

// Server action wrapping `artist.purchase.request` (BE-1, Gate 1). Fired by
// the S4 "Send request" CTA. Creates intent-only pending request data and
// returns the ref shown on S5. Tagged union so the
// client can branch without parsing exceptions (store-checkout pattern).
export async function requestToBookAction(input: {
  productId: string;
  operationKey: string;
  songQty?: number;
  projectId?: string;
}): Promise<
  { ok: true; purchaseRequestId: string; refNumber: string } | { ok: false; error: string }
> {
  const { userId } = await auth();
  if (!userId) return { ok: false, error: "Not signed in" };

  const caller = appRouter.createCaller({ userId });
  try {
    const result = await caller.artist.purchase.request({
      productId: input.productId,
      operationKey: input.operationKey,
      ...(input.songQty === undefined ? {} : { songQty: input.songQty }),
      ...(input.projectId === undefined ? {} : { projectId: input.projectId }),
    });
    revalidatePath("/dashboard", "layout");
    revalidatePath("/dashboard/requests", "layout");
    revalidatePath(`/dashboard/requests/${result.purchaseRequestId}`);
    return {
      ok: true,
      purchaseRequestId: result.purchaseRequestId,
      refNumber: result.refNumber,
    };
  } catch (e) {
    if (e instanceof TRPCError) return { ok: false, error: e.message };
    return { ok: false, error: "Couldn't send your request. Try again." };
  }
}

export async function acceptPurchaseAction(input: {
  purchaseRequestId: string;
  paymentPlan: PaymentPlanChoice;
  expectedSnapshotDigest: string;
  operationKey: string;
  agreementAccepted: true;
}): Promise<{ ok: true; purchaseId: string; productId: string } | ActionError> {
  const { userId } = await auth();
  if (!userId) return { ok: false, error: "Not signed in" };

  try {
    const caller = appRouter.createCaller({ userId });
    const result = await caller.artist.purchase.acceptance.accept(input);
    revalidatePath("/artist", "layout");
    revalidatePath(`/artist/purchase/${result.productId}`);
    revalidatePath("/dashboard", "layout");
    revalidatePath("/dashboard/requests", "layout");
    revalidatePath(`/dashboard/requests/${input.purchaseRequestId}`);
    return {
      ok: true,
      purchaseId: result.purchaseId,
      productId: result.productId,
    };
  } catch (error) {
    return errorResult(error, "Couldn't accept this agreement. Refresh and try again.");
  }
}

export async function presignProofUploadAction(input: {
  purchaseRequestId: string;
  fileName: string;
  contentType: ProofContentType;
  sizeBytes: number;
}): Promise<{ ok: true; uploadUrl: string } | ActionError> {
  const { userId } = await auth();
  if (!userId) return { ok: false, error: "Not signed in" };

  try {
    const caller = appRouter.createCaller({ userId });
    const result = await caller.artist.purchase.proofOfPayment.presign(input);
    return { ok: true, uploadUrl: result.uploadUrl };
  } catch (error) {
    return errorResult(error, "Couldn't prepare the upload. Try again.");
  }
}

export async function submitPaymentProofAction(input: {
  purchaseRequestId: string;
  amountCents: number;
  originalFileName: string;
}): Promise<{ ok: true; proofId: string } | ActionError> {
  const { userId } = await auth();
  if (!userId) return { ok: false, error: "Not signed in" };

  try {
    const caller = appRouter.createCaller({ userId });
    const result = await caller.artist.purchase.proofOfPayment.submit({
      purchaseRequestId: input.purchaseRequestId,
      amountCents: input.amountCents,
      originalFileName: input.originalFileName,
    });
    revalidatePath("/artist", "layout");
    if (result.productId) {
      revalidatePath(`/artist/purchase/${result.productId}/pay`);
      revalidatePath(`/artist/purchase/${result.productId}/pay/instructions`);
      revalidatePath(`/artist/purchase/${result.productId}/pay/proof`);
    }
    revalidatePath("/dashboard", "layout");
    revalidatePath("/dashboard/requests", "layout");
    revalidatePath(`/dashboard/requests/${result.purchaseRequestId}`);
    return { ok: true, proofId: result.proofId };
  } catch (error) {
    return errorResult(error, "Couldn't send the proof. Try again.");
  }
}
