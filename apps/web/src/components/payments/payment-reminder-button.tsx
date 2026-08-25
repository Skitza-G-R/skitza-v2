"use client";

import { useRef, useState, useTransition } from "react";

import {
  type PaymentReminderRetryDisposition,
  sendPaymentReminderAction,
} from "~/app/(producer)/dashboard/payments/reminder-actions";
import { useOnlineStatus } from "~/components/runtime-state/online-required-link";
import { Button } from "~/components/ui/button";
import { useToast } from "~/components/ui/toast";
import { cn } from "~/lib/cn";

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
  layout = "block",
}: {
  purchaseId: string;
  installmentId: string;
  installmentLabel: string;
  /** `inline` fits a dense Payments row: short label, no top margin, status read out only. */
  layout?: "block" | "inline";
}) {
  const inline = layout === "inline";
  const { toast } = useToast();
  const online = useOnlineStatus();
  const [pending, startTransition] = useTransition();
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const retryKey = useRef<string | null>(null);

  function sendReminder() {
    if (pending) return;
    if (!online) {
      toast("Reconnect to send a payment reminder.", "error");
      return;
    }
    retryKey.current = paymentReminderOperationKey(retryKey.current);
    const operationKey = retryKey.current;
    setSuccessMessage(null);

    startTransition(async () => {
      try {
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
      } catch {
        toast("Could not send this reminder. Please try again.", "error");
      }
    });
  }

  return (
    <div className={cn("flex flex-wrap items-center gap-2", !inline && "mt-3")}>
      <Button
        type="button"
        size="sm"
        variant="outline"
        aria-label={`Send payment reminder for ${installmentLabel}`}
        className={cn(
          "min-h-11 rounded-[var(--radius-lg)]",
          inline ? "px-3 sm:min-h-9 sm:rounded-[var(--radius-md)]" : "w-full sm:w-auto",
        )}
        disabled={pending || !online}
        onClick={sendReminder}
      >
        {pending ? "Sending…" : inline ? "Remind" : "Send reminder"}
      </Button>
      {successMessage ? (
        <span
          role="status"
          className={cn(
            "text-[11.5px] font-semibold text-[rgb(var(--fg-success))]",
            inline && "sr-only",
          )}
        >
          {successMessage}
        </span>
      ) : null}
    </div>
  );
}
