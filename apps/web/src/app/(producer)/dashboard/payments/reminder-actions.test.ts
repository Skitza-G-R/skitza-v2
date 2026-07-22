import { TRPCError } from "@trpc/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  revalidatePath: vi.fn(),
  sendReminder: vi.fn(),
}));

vi.mock("@clerk/nextjs/server", () => ({ auth: mocks.auth }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("~/server/trpc/routers/_app", () => ({
  appRouter: {
    createCaller: () => ({ purchaseLedger: { sendReminder: mocks.sendReminder } }),
  },
}));

import { sendPaymentReminderAction } from "./reminder-actions";

const input = {
  purchaseId: "purchase-a",
  installmentId: "installment-a",
  operationKey: "payment-reminder:attempt-a",
};

describe("sendPaymentReminderAction retry disposition", () => {
  beforeEach(() => {
    mocks.auth.mockReset().mockResolvedValue({ userId: "producer-user-a" });
    mocks.revalidatePath.mockReset();
    mocks.sendReminder.mockReset();
  });

  it("replaces the key only when the domain explicitly requests a new reminder", async () => {
    mocks.sendReminder.mockRejectedValue(
      new TRPCError({
        code: "CONFLICT",
        message:
          "This reminder delivery can no longer be retried safely; send a new explicit reminder",
      }),
    );

    await expect(sendPaymentReminderAction(input)).resolves.toEqual({
      ok: false,
      error:
        "This reminder delivery can no longer be retried safely; send a new explicit reminder",
      retryDisposition: "replace-operation-key",
    });
  });

  it("keeps the key while the same reminder may still be delivered", async () => {
    mocks.sendReminder.mockRejectedValue(
      new TRPCError({
        code: "CONFLICT",
        message: "This reminder is already being delivered",
      }),
    );

    await expect(sendPaymentReminderAction(input)).resolves.toEqual({
      ok: false,
      error: "This reminder is already being delivered",
      retryDisposition: "keep-operation-key",
    });
  });

  it("keeps the key for an unknown or network failure", async () => {
    mocks.sendReminder.mockRejectedValue(new Error("socket closed after request"));

    await expect(sendPaymentReminderAction(input)).resolves.toEqual({
      ok: false,
      error: "Could not send the reminder. Please try again.",
      retryDisposition: "keep-operation-key",
    });
  });
});
