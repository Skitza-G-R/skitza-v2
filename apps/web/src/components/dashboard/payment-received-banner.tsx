"use client";

import { X } from "lucide-react";
import Link from "next/link";
import { useState, useTransition } from "react";

import { useToast } from "~/components/ui/toast";
import { acknowledgePaymentAction } from "~/app/(producer)/dashboard/payment-banner-actions";

// SK-20 — "you just got paid" banner. Renders above OverviewScreen on
// /dashboard for every confirmed booking the producer hasn't dismissed
// yet (booking.recentPaidUnacknowledged). Per-row ✕ stamps
// producer_acknowledged_at = now() via the server action, then the
// page revalidates and the row drops off.
//
// Visual language mirrors FinishSetupNudge (the page.tsx-local
// component): brand-tinted card with the same margin shape so the two
// banners stack cleanly when both are firing. Success-tinted accents
// distinguish "money in" from setup nudges.

export interface PaymentReceivedBannerProps {
  bookings: Array<{
    id: string;
    artistName: string;
    packageNameSnapshot: string | null;
    unitPriceCents: number | null;
    songQty: number | null;
    projectId: string | null;
    projectName: string;
  }>;
}

function formatAmount(unitPriceCents: number | null, songQty: number | null): string {
  // Banner currency anchors to ILS — same fallback the email + activity
  // feed use for v1 (Israeli market). Per-producer currency lands when
  // SK-6 (payment routing) wires real fee math through.
  const qty = songQty ?? 1;
  const cents = (unitPriceCents ?? 0) * qty;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "ILS",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

export function PaymentReceivedBanner({ bookings }: PaymentReceivedBannerProps) {
  if (bookings.length === 0) return null;
  return (
    <div className="mx-4 mb-5 mt-5 flex flex-col gap-2 sm:mx-6">
      {bookings.map((b) => (
        <PaymentReceivedRow key={b.id} booking={b} />
      ))}
    </div>
  );
}

function PaymentReceivedRow({
  booking,
}: {
  booking: PaymentReceivedBannerProps["bookings"][number];
}) {
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  // Optimistically hide the row on dismiss so the producer gets instant
  // feedback even before the page revalidate completes. A failed action
  // flips it back so the producer can retry.
  const [hidden, setHidden] = useState(false);

  if (hidden) return null;

  const amount = formatAmount(booking.unitPriceCents, booking.songQty);
  const href = booking.projectId
    ? `/dashboard/clients-projects/${booking.projectId}`
    : "/dashboard/clients-projects";

  function onDismiss() {
    setHidden(true);
    startTransition(async () => {
      const res = await acknowledgePaymentAction({ bookingId: booking.id });
      if (!res.ok) {
        setHidden(false);
        toast(res.error, "error");
      }
    });
  }

  return (
    <div
      role="status"
      className="relative flex items-center gap-3 rounded-[var(--radius-md)] border border-[rgb(var(--success)/0.4)] bg-[rgb(var(--success)/0.06)] p-4 pr-12"
    >
      <Link href={href} className="min-w-0 flex-1">
        <p className="text-sm font-medium text-[rgb(var(--fg-primary))]">
          {`💰 ${booking.artistName} paid ${amount} for ${booking.projectName}`}
        </p>
        <p className="mt-0.5 font-mono text-[10.5px] uppercase tracking-widest text-[rgb(var(--fg-muted))]">
          Open project →
        </p>
      </Link>
      <button
        type="button"
        onClick={onDismiss}
        disabled={pending}
        aria-label="Dismiss payment notification"
        className="absolute right-3 top-3 flex h-7 w-7 items-center justify-center rounded-full text-[rgb(var(--fg-muted))] hover:bg-[rgb(var(--bg-hover))] hover:text-[rgb(var(--fg-primary))] disabled:opacity-50"
      >
        <X size={14} />
      </button>
    </div>
  );
}
