"use server";

import { auth } from "~/server/auth/clerk-identity";

import { appRouter } from "~/server/trpc/routers/_app";

export type SavePaymentInstructionsResult = { ok: true } | { ok: false; error: string };

export async function saveOnboardingPaymentInstructions(input: {
  bankTransfer?: string;
  bitPhone?: string;
  note?: string;
}): Promise<SavePaymentInstructionsResult> {
  const { userId } = await auth();
  if (!userId) {
    return { ok: false, error: "Please sign in to save your payment details." };
  }

  try {
    const caller = appRouter.createCaller({ userId });
    await caller.producer.purchase.paymentInstructions.update(input);
    return { ok: true };
  } catch {
    return {
      ok: false,
      error: "Could not save your payment details. Try again.",
    };
  }
}
