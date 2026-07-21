"use client";

import { useRef, useState, useTransition } from "react";

import {
  type PaymentReminderRetryDisposition,
  sendPaymentReminderAction,
} from "~/app/(producer)/dashboard/payments/reminder-actions";
import { Button } from "~/components/ui/button";
import { useToast } from "~/components/ui/toast";

type CreateOperationId = () => string;

const createOperationId: CreateOperationId = () => crypto.randomUUID();

export function paymentReminderOperationKey(
  activeKey: string | null,
  createId: CreateOperationId = createOperationId,
): string {
  return activeKey ?? `payment-reminder:${createId()}`;
}

export function paymentReminderOperationKeyAfterResult(
  result:
    | { ok: true }
    | { ok: false; retryDisposition: PaymentReminderRetryDisposition },
  activeKey: string,
  createId: CreateOperationId = createOperationId,
): string | null {
  if (result.ok) return null;
  return result.retryDisposition === "replace-operation-key"
    ? paymentReminderOperationKey(null, createId)
    : activeKey;
}

export function PaymentReminderButton({
  purchaseId,
  installmentId,
  installmentLabel,
}: {
  purchaseId: string;
  installmentId: string;
  installmentLabel: string;
}) {
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const retryKey = useRef<string | null>(null);

  function sendReminder() {
    if (pending) return;
    retryKey.current = paymentReminderOperationKey(retryKey.current);
    const operationKey = retryKey.current;
    setSuccessMessage(null);

    startTransition(async () => {
      const result = await sendPaymentReminderAction({
        purchaseId,
        installmentId,
        operationKey,
      });
      retryKey.current = paymentReminderOperationKeyAfterResult(result, operationKey);
      if (!result.ok) {
        toast(result.error, "error");
        return;
      }

      setSuccessMessage(result.created ? "Reminder sent." : "Reminder already sent.");
      toast(
        result.created ? "Payment reminder sent and logged." : "Reminder already sent.",
        "success",
      );
    });
  }

  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <Button
        type="button"
        size="sm"
        variant="outline"
        aria-label={`Send payment reminder for ${installmentLabel}`}
        className="min-h-11 w-full rounded-[var(--radius-lg)] sm:w-auto"
        disabled={pending}
        onClick={sendReminder}
      >
        {pending ? "Sending…" : "Send reminder"}
      </Button>
      {successMessage ? (
        <span
          role="status"
          className="text-[11.5px] font-semibold text-[rgb(var(--fg-success))]"
        >
          {successMessage}
        </span>
      ) : null}
    </div>
  );
}
