"use server";

import { auth } from "~/server/auth/clerk-identity";
import { TRPCError } from "@trpc/server";
import { revalidatePath } from "next/cache";

import { appRouter } from "~/server/trpc/routers/_app";

export type PaymentReminderRetryDisposition = "keep-operation-key" | "replace-operation-key";

export type SendPaymentReminderResult =
  | { ok: true; created: boolean }
  | {
      ok: false;
      error: string;
      retryDisposition: PaymentReminderRetryDisposition;
    };

function retryDispositionForKnownError(message: string): PaymentReminderRetryDisposition {
  return message.toLowerCase().includes("send a new explicit reminder")
    ? "replace-operation-key"
    : "keep-operation-key";
}

export async function sendPaymentReminderAction(input: {
  purchaseId: string;
  installmentId: string;
  operationKey: string;
}): Promise<SendPaymentReminderResult> {
  const { userId } = await auth();
  if (!userId) {
    return {
      ok: false,
      error: "Please sign in to continue.",
      retryDisposition: "keep-operation-key",
    };
  }

  try {
    const caller = appRouter.createCaller({ userId });
    const result = await caller.purchaseLedger.sendReminder(input);
    revalidatePath("/dashboard", "layout");
    revalidatePath("/dashboard/payments", "layout");
    revalidatePath("/dashboard/clients-projects", "layout");
    return { ok: true, created: result.created };
  } catch (error) {
    if (error instanceof TRPCError && error.message) {
      return {
        ok: false,
        error: error.message,
        retryDisposition: retryDispositionForKnownError(error.message),
      };
    }
    return {
      ok: false,
      error: "Could not send the reminder. Please try again.",
      retryDisposition: "keep-operation-key",
    };
  }
}
