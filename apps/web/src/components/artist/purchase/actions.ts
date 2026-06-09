"use server";

import { auth } from "@clerk/nextjs/server";
import { TRPCError } from "@trpc/server";
import type { PaymentPlan } from "@skitza/db";

import { appRouter } from "~/server/trpc/routers/_app";

// Until BE-2 lands plan choice (S7 is still mock), the request locks the
// product's default plan: pay-in-full when offered, else the first plan
// the producer configured. BE-1 validates it against the product either way.
function defaultPlan(plans: PaymentPlan[]): PaymentPlan {
  return plans.find((p) => p.kind === "full") ?? plans[0] ?? { kind: "full" };
}

// Server action wrapping `artist.purchase.request` (BE-1, Gate 1). Fired by
// the S4 "Send request" CTA. Locks the price server-side, creates the
// pending request, and returns the ref shown on S5. Tagged union so the
// client can branch without parsing exceptions (store-checkout pattern).
export async function requestToBookAction(input: {
  productId: string;
}): Promise<
  | { ok: true; purchaseRequestId: string; refNumber: string }
  | { ok: false; error: string }
> {
  const { userId } = await auth();
  if (!userId) return { ok: false, error: "Not signed in" };

  const caller = appRouter.createCaller({ userId });
  try {
    const product = await caller.artist.store.product({
      productId: input.productId,
    });
    const result = await caller.artist.purchase.request({
      productId: input.productId,
      paymentPlan: defaultPlan(product.paymentPlans),
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
