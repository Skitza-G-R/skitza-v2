"use server";

import { auth } from "@clerk/nextjs/server";
import { TRPCError } from "@trpc/server";
import { revalidatePath } from "next/cache";

import { appRouter } from "~/server/trpc/routers/_app";

export type SendPaymentReminderResult =
  | { ok: true; created: boolean }
  | { ok: false; error: string };

export async function sendPaymentReminderAction(input: {
  purchaseId: string;
  installmentId: string;
  operationKey: string;
}): Promise<SendPaymentReminderResult> {
  const { userId } = await auth();
  if (!userId) return { ok: false, error: "Please sign in to continue." };

  try {
    const caller = appRouter.createCaller({ userId });
    const result = await caller.purchaseLedger.sendReminder(input);
    revalidatePath("/dashboard", "layout");
    revalidatePath("/dashboard/payments", "layout");
    revalidatePath("/dashboard/clients-projects", "layout");
    return { ok: true, created: result.created };
  } catch (error) {
    if (error instanceof TRPCError && error.message) {
      return { ok: false, error: error.message };
    }
    return { ok: false, error: "Could not send the reminder. Please try again." };
  }
}
