"use server";

import { auth } from "@clerk/nextjs/server";
import { TRPCError } from "@trpc/server";
import type { PaymentPlan } from "@skitza/db";

import { appRouter } from "~/server/trpc/routers/_app";

// Server action wrapping the artist.store.checkout mutation. The
// client calls this on "Continue to checkout"; on success we return
// the Stripe URL and the client redirects window.location.href.
//
// Returns a tagged-discriminated shape so the client can branch on
// success vs. a typed error (wrong studio → NOT_FOUND, bad plan →
// BAD_REQUEST) without having to parse the exception type.
export async function startStoreCheckoutAction(input: {
  productId: string;
  paymentPlan: PaymentPlan;
  // Per-song pricing — populated by the SongCountStepper on per_song
  // products. The mutation uses these to compute the locked-in total
  // (songQty × unitPriceCents) and ignores them for flat products.
  songQty?: number;
  unitPriceCents?: number;
}): Promise<
  | { ok: true; checkoutUrl: string | null; projectId: string }
  | { ok: false; error: string }
> {
  const { userId } = await auth();
  if (!userId) return { ok: false, error: "Not signed in" };

  const caller = appRouter.createCaller({ userId });
  try {
    const result = await caller.artist.store.checkout(input);
    return {
      ok: true,
      checkoutUrl: result.checkoutUrl,
      projectId: result.projectId,
    };
  } catch (e) {
    if (e instanceof TRPCError) return { ok: false, error: e.message };
    return { ok: false, error: "Could not start checkout" };
  }
}
