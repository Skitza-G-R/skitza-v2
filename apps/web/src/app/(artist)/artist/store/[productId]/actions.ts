"use server";

import { auth } from "@clerk/nextjs/server";
import { TRPCError } from "@trpc/server";

import { appRouter } from "~/server/trpc/routers/_app";

// Intent-only request boundary. Price, plan, and agreement terms are not
// accepted here; the server freezes them later at purchase acceptance.
export async function requestStorePurchaseAction(input: {
  productId: string;
  operationKey: string;
  songQty?: number;
}): Promise<
  | { ok: true; purchaseRequestId: string; refNumber: string }
  | { ok: false; error: string }
> {
  const { userId } = await auth();
  if (!userId) return { ok: false, error: "Not signed in" };

  const caller = appRouter.createCaller({ userId });
  try {
    const result = await caller.artist.purchase.request(input);
    return {
      ok: true,
      purchaseRequestId: result.purchaseRequestId,
      refNumber: result.refNumber,
    };
  } catch (e) {
    if (e instanceof TRPCError) return { ok: false, error: e.message };
    return { ok: false, error: "Could not send request" };
  }
}
