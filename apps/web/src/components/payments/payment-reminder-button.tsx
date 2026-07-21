"use client";

import { useRef, useTransition } from "react";

import { sendPaymentReminderAction } from "~/app/(producer)/dashboard/payments/reminder-actions";
import { Button } from "~/components/ui/button";
import { useToast } from "~/components/ui/toast";

export function PaymentReminderButton({
  purchaseId,
  installmentId,
}: {
  purchaseId: string;
  installmentId: string;
}) {
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const retryKey = useRef<string | null>(null);

  function sendReminder() {
    if (pending) return;
    retryKey.current ??= `payment-reminder:${crypto.randomUUID()}`;
    const operationKey = retryKey.current;

    startTransition(async () => {
      const result = await sendPaymentReminderAction({
        purchaseId,
        installmentId,
        operationKey,
      });
      if (!result.ok) {
        toast(result.error, "error");
        return;
      }

      retryKey.current = null;
      toast(
        result.created ? "Payment reminder sent and logged." : "Reminder already sent.",
        "success",
      );
    });
  }

  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      className="mt-3 min-h-11 w-full rounded-[var(--radius-lg)] sm:w-auto"
      disabled={pending}
      onClick={sendReminder}
    >
      {pending ? "Sending…" : "Send reminder"}
    </Button>
  );
}
