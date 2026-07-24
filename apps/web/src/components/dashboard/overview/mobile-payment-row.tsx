"use client";

import { Banknote, X } from "lucide-react";
import Link from "next/link";
import { useState, useTransition } from "react";

import { acknowledgePaymentAction } from "~/app/(producer)/dashboard/payment-banner-actions";
import { useOnlineStatus } from "~/components/runtime-state/online-required-link";
import { useToast } from "~/components/ui/toast";

// Mobile-feed variant of the SK-20 payment-received banner row. Same
// server action + optimistic-dismiss behavior as
// payment-received-banner.tsx, restyled as a compact action card for
// the phone feed. Notable copy fix from Gili's audit: a booking with
// no recorded amount used to render "paid ₪0" — when the amount is
// missing/zero we now say "sent a payment" instead of showing ₪0.

export interface MobilePaymentRowProps {
  booking: {
    id: string;
    artistName: string;
    unitPriceCents: number | null;
    songQty: number | null;
    projectId: string | null;
    projectName: string;
  };
}

function formatAmount(unitPriceCents: number | null, songQty: number | null): string | null {
  const qty = songQty ?? 1;
  const cents = (unitPriceCents ?? 0) * qty;
  if (cents <= 0) return null;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "ILS",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

export function MobilePaymentRow({ booking }: MobilePaymentRowProps) {
  const { toast } = useToast();
  const online = useOnlineStatus();
  const [pending, startTransition] = useTransition();
  const [hidden, setHidden] = useState(false);

  if (hidden) return null;

  const amount = formatAmount(booking.unitPriceCents, booking.songQty);
  const href = booking.projectId
    ? `/dashboard/clients-projects/${booking.projectId}`
    : "/dashboard/clients-projects";

  function onDismiss() {
    if (!online) {
      toast("Reconnect to dismiss this payment notice.", "error");
      return;
    }
    setHidden(true);
    startTransition(async () => {
      try {
        const res = await acknowledgePaymentAction({ bookingId: booking.id });
        if (res.ok) return;
        setHidden(false);
        toast(res.error, "error");
      } catch {
        setHidden(false);
        toast("Could not dismiss this payment notice. Try again.", "error");
      }
    });
  }

  return (
    <div
      role="status"
      className="relative rounded-[var(--radius-lg)] border border-[rgb(var(--fg-success)/0.4)] bg-[rgb(var(--fg-success)/0.06)] p-3.5"
    >
      <Link href={href} className="flex items-center gap-3 pr-8">
        <span
          aria-hidden
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[rgb(var(--fg-success)/0.14)] text-[rgb(var(--fg-success))]"
        >
          <Banknote size={16} strokeWidth={2.2} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm leading-snug font-bold text-[rgb(var(--fg-default))]">
            {amount
              ? `${booking.artistName} paid ${amount}`
              : `${booking.artistName} sent a payment`}
          </p>
          <p className="mt-0.5 truncate text-xs text-[rgb(var(--fg-muted))]">
            {booking.projectName}
            <span className="mx-1.5 opacity-40">·</span>
            Open project →
          </p>
        </div>
      </Link>
      <button
        type="button"
        onClick={onDismiss}
        disabled={pending}
        aria-label="Dismiss payment notification"
        className="absolute top-2 right-2 flex h-8 w-8 items-center justify-center rounded-full text-[rgb(var(--fg-muted))] hover:bg-[rgb(var(--bg-hover))] hover:text-[rgb(var(--fg-default))] disabled:opacity-50"
      >
        <X size={14} />
      </button>
    </div>
  );
}
