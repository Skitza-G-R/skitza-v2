"use server";

import { auth } from "@clerk/nextjs/server";
import { TRPCError } from "@trpc/server";
import { revalidatePath } from "next/cache";

import {
  offeredPlans,
  type PaymentPlanChoice,
} from "~/lib/purchase/request-helpers";
import { selectProvisionalRequestPaymentPlan } from "~/lib/payment-plans";
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
// the S4 "Send request" CTA. Locks the price server-side, creates the
// pending request, and returns the ref shown on S5. Tagged union so the
// client can branch without parsing exceptions (store-checkout pattern).
export async function requestToBookAction(input: {
  productId: string;
  commercialTermsFingerprint: string;
}): Promise<
  { ok: true; purchaseRequestId: string; refNumber: string } | { ok: false; error: string }
> {
  const { userId } = await auth();
  if (!userId) return { ok: false, error: "Not signed in" };

  const caller = appRouter.createCaller({ userId });
  try {
    const product = await caller.artist.store.product({
      productId: input.productId,
    });
    const provisionalPlan = selectProvisionalRequestPaymentPlan(offeredPlans(product));
    if (!provisionalPlan) {
      return { ok: false, error: "This product has no payment option." };
    }
    const result = await caller.artist.purchase.request({
      productId: input.productId,
      paymentPlan: provisionalPlan,
      agreementAccepted: true,
      commercialTermsFingerprint: input.commercialTermsFingerprint,
    });
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

export async function choosePaymentPlanAction(input: {
  purchaseRequestId: string;
  paymentPlan: PaymentPlanChoice;
}): Promise<{ ok: true } | ActionError> {
  const { userId } = await auth();
  if (!userId) return { ok: false, error: "Not signed in" };

  try {
    const caller = appRouter.createCaller({ userId });
    await caller.artist.purchase.paymentPlan.choose(input);
    return { ok: true };
  } catch (error) {
    return errorResult(error, "Couldn't save that plan. Try again.");
  }
}

export async function presignProofUploadAction(input: {
  purchaseRequestId: string;
  fileName: string;
  contentType: ProofContentType;
  sizeBytes: number;
}): Promise<{ ok: true; uploadUrl: string; storageKey: string } | ActionError> {
  const { userId } = await auth();
  if (!userId) return { ok: false, error: "Not signed in" };

  try {
    const caller = appRouter.createCaller({ userId });
    const result = await caller.artist.purchase.proofOfPayment.presign(input);
    return { ok: true, ...result };
  } catch (error) {
    return errorResult(error, "Couldn't prepare the upload. Try again.");
  }
}

export async function submitPaymentProofAction(input: {
  purchaseRequestId: string;
  amountCents: number;
  storageKey: string;
  originalFileName: string;
}): Promise<{ ok: true; proofId: string } | ActionError> {
  const { userId } = await auth();
  if (!userId) return { ok: false, error: "Not signed in" };

  try {
    const caller = appRouter.createCaller({ userId });
    const result = await caller.artist.purchase.proofOfPayment.submit(input);
    revalidatePath("/artist");
    return { ok: true, proofId: result.proofId };
  } catch (error) {
    return errorResult(error, "Couldn't send the proof. Try again.");
  }
}
