"use server";

import { auth } from "~/server/auth/clerk-identity";
import { TRPCError } from "@trpc/server";
import type { PaymentPlan } from "@skitza/db";
import { revalidatePath } from "next/cache";

import { appRouter } from "~/server/trpc/routers/_app";

type ActionFailure = { ok: false; error: string };

function failure(error: unknown): ActionFailure {
  if (error instanceof TRPCError) {
    return { ok: false, error: error.message || "This offer is unavailable." };
  }
  return { ok: false, error: "This offer is unavailable." };
}

function validDate(raw: string): Date | null {
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}

export async function acceptPrivateOfferAction(input: {
  offerId: string;
  expectedUpdatedAt: string;
  expectedTargetProjectTitle: string | null;
  selectedPaymentPlan: PaymentPlan | null;
  agreementAccepted: true;
}): Promise<
  | {
      ok: true;
      purchaseId: string;
      projectId: string;
      lifecycleStatus: "waiting_for_payment" | "active";
      created: boolean;
    }
  | ActionFailure
> {
  const { userId } = await auth();
  if (!userId) return { ok: false, error: "Not signed in" };
  const expectedUpdatedAt = validDate(input.expectedUpdatedAt);
  if (!expectedUpdatedAt) return { ok: false, error: "Refresh this offer and try again." };

  try {
    const caller = appRouter.createCaller({ userId });
    const result = await caller.privateOffers.accept({
      offerId: input.offerId,
      expectedUpdatedAt,
      expectedTargetProjectTitle: input.expectedTargetProjectTitle,
      selectedPaymentPlan: input.selectedPaymentPlan,
      agreementAccepted: input.agreementAccepted,
    });
    revalidatePath("/artist", "layout");
    revalidatePath(`/artist/offers/${input.offerId}`);
    revalidatePath("/dashboard/store");
    const lifecycleStatus = result.lifecycleStatus;
    if (lifecycleStatus === "canceled") {
      return { ok: false, error: "This offer is unavailable." };
    }
    return {
      ok: true,
      purchaseId: result.purchaseId,
      projectId: result.projectId,
      lifecycleStatus,
      created: result.created,
    };
  } catch (error) {
    return failure(error);
  }
}

export async function rejectPrivateOfferAction(
  offerId: string,
): Promise<{ ok: true; changed: boolean } | ActionFailure> {
  const { userId } = await auth();
  if (!userId) return { ok: false, error: "Not signed in" };
  try {
    const caller = appRouter.createCaller({ userId });
    const result = await caller.privateOffers.reject({ offerId });
    revalidatePath("/artist", "layout");
    revalidatePath(`/artist/offers/${offerId}`);
    revalidatePath("/dashboard/store");
    return { ok: true, changed: result.changed };
  } catch (error) {
    return failure(error);
  }
}
