"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { CircleCheckBig, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { type RefObject, useRef, useState, useTransition } from "react";

import { requestFinalPaymentAction } from "~/app/(producer)/dashboard/clients-projects/actions";
import { formatMoney } from "~/components/dashboard/payments/record-payment-model";
import type { ProjectPurchaseSummary } from "~/components/dashboard/projects/project-purchases-panel";
import { useOnlineStatus } from "~/components/runtime-state/online-required-link";
import { useToast } from "~/components/ui/toast";

/**
 * SK-269 — on a 50/50 plan the last half waits for the client to approve the
 * final version inside Skitza. A client the producer imported by hand may never
 * join, so that never happens and the money is stuck: not shown as owed, not
 * recordable, not even waivable. Here the producer says the work is done and
 * the payment becomes due today. The server enforces the same rule, so this
 * card is a shortcut, never the permission.
 */
export interface RequestFinalPaymentCardProps {
  projectId: string;
  purchase: ProjectPurchaseSummary;
  request: Readonly<{ installmentId: string; amountCents: number }>;
}

export function RequestFinalPaymentCard({
  projectId,
  purchase,
  request,
}: RequestFinalPaymentCardProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const amount = formatMoney(request.amountCents, purchase.currency);

  return (
    <div className="flex flex-col gap-3 rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-3.5 sm:flex-row sm:items-center sm:justify-between sm:p-4">
      <div className="min-w-0">
        <p className="text-[13px] font-bold text-[rgb(var(--fg-default))]">
          The last payment is waiting
        </p>
        <p className="mt-0.5 text-[12px] leading-relaxed text-[rgb(var(--fg-muted))]">
          {amount} for {purchase.sourceLabel} stays on hold until the work is finished. This client
          may never mark it done in Skitza, so you can do it here.
        </p>
      </div>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => {
          setOpen(true);
        }}
        className="sk-press inline-flex min-h-12 items-center justify-center gap-2 rounded-[var(--radius-lg)] bg-[rgb(var(--fg-default))] px-4 py-2 text-center text-[13px] font-bold text-[rgb(var(--bg-background))] focus-visible:ring-2 focus-visible:ring-[rgb(var(--focus-ring))] focus-visible:outline-none sm:max-w-[15rem]"
      >
        <CircleCheckBig size={16} strokeWidth={2.2} aria-hidden />
        The work is done — ask for the final payment
      </button>

      {open ? (
        <RequestFinalPaymentDialog
          projectId={projectId}
          purchase={purchase}
          request={request}
          amount={amount}
          triggerRef={triggerRef}
          onClose={() => {
            setOpen(false);
          }}
        />
      ) : null}
    </div>
  );
}

function RequestFinalPaymentDialog({
  projectId,
  purchase,
  request,
  amount,
  triggerRef,
  onClose,
}: RequestFinalPaymentCardProps & {
  amount: string;
  triggerRef: RefObject<HTMLButtonElement | null>;
  onClose: () => void;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const online = useOnlineStatus();
  const [pending, startTransition] = useTransition();

  const confirm = () => {
    if (!online) {
      toast("Reconnect to ask for this payment.", "error");
      return;
    }
    startTransition(async () => {
      try {
        const result = await requestFinalPaymentAction({
          projectId,
          purchaseId: purchase.id,
          installmentId: request.installmentId,
        });
        if (!result.ok) {
          toast(result.error, "error");
          return;
        }
        toast(`${amount} is now due`, "success");
        router.refresh();
        onClose();
      } catch {
        toast("Could not ask for this payment. Try again.", "error");
      }
    });
  };

  return (
    <DialogPrimitive.Root
      open
      onOpenChange={(nextOpen) => {
        if (!nextOpen && !pending) onClose();
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-[rgb(17_16_9/0.42)] backdrop-blur-[3px]" />
        <DialogPrimitive.Content
          onCloseAutoFocus={(event) => {
            const target = triggerRef.current;
            if (!target?.isConnected) return;
            event.preventDefault();
            target.focus();
          }}
          className="sk-sheet-mobile fixed top-1/2 left-1/2 z-50 max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-[480px] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-[var(--radius-lg)] bg-[rgb(var(--bg-background))] p-5 shadow-[0_40px_80px_-20px_rgba(17,16,9,0.45),0_14px_32px_-12px_rgba(17,16,9,0.22)]"
        >
          <div className="flex items-start gap-3">
            <span
              aria-hidden
              className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-[rgb(var(--bg-elevated))] text-[rgb(var(--fg-default))]"
            >
              <CircleCheckBig size={20} strokeWidth={2.1} />
            </span>
            <div className="min-w-0 flex-1">
              <DialogPrimitive.Title className="font-display text-[17px] font-extrabold tracking-[-0.02em] break-words text-[rgb(var(--fg-default))]">
                Ask for the final payment?
              </DialogPrimitive.Title>
              <DialogPrimitive.Description className="mt-1 text-[13px] leading-snug text-[rgb(var(--fg-muted))]">
                {amount} for {purchase.sourceLabel}.
              </DialogPrimitive.Description>
            </div>
            <DialogPrimitive.Close asChild>
              <button
                type="button"
                aria-label="Close"
                disabled={pending}
                className="sk-press -mt-2 -mr-2 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-[rgb(var(--fg-muted))] hover:bg-[rgb(17_16_9/0.06)] hover:text-[rgb(var(--fg-default))] disabled:opacity-50"
              >
                <X size={16} strokeWidth={2.2} aria-hidden />
              </button>
            </DialogPrimitive.Close>
          </div>

          <div className="mt-4 rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-3.5 text-[12.5px] leading-relaxed text-[rgb(var(--fg-secondary))]">
            <ul className="space-y-1.5">
              <li>The payment shows as owed from today.</li>
              <li>You can then record it, or write it off if it will never be paid.</li>
              {/* Honest: a due date is what makes an installment eligible for
                  the automatic reminder sweep, unconnected clients included. */}
              <li>No money moves. If you have payment reminders on, this payment joins them.</li>
              <li>This cannot be undone.</li>
            </ul>
          </div>

          <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={onClose}
              disabled={pending}
              className="sk-press inline-flex min-h-11 items-center justify-center rounded-[var(--radius-lg)] px-4 text-[13px] font-semibold text-[rgb(var(--fg-muted))] hover:bg-[rgb(17_16_9/0.06)] disabled:opacity-50"
            >
              Not yet
            </button>
            <button
              type="button"
              onClick={confirm}
              disabled={pending}
              className="sk-press inline-flex min-h-11 items-center justify-center gap-1.5 rounded-[var(--radius-lg)] bg-[rgb(var(--fg-default))] px-4 text-[13px] font-semibold text-[rgb(var(--bg-background))] disabled:opacity-45"
            >
              <CircleCheckBig size={15} strokeWidth={2.2} aria-hidden />
              {pending ? "Asking…" : "Yes, the work is done"}
            </button>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
