"use client";

import { CheckCircle2, X } from "lucide-react";
import Link from "next/link";
import { useState, useTransition } from "react";

import { acknowledgePaymentAction } from "~/app/(producer)/dashboard/payment-banner-actions";
import { useOnlineStatus } from "~/components/runtime-state/online-required-link";
import { formatMoney } from "~/lib/format/money";

import type { PaymentSource } from "./needs-you";

export function NeedsYouPaymentRow({
  payment,
  currency,
}: {
  payment: PaymentSource;
  currency: string | null;
}) {
  const [hidden, setHidden] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const online = useOnlineStatus();

  if (hidden) return null;

  const cents = (payment.unitPriceCents ?? 0) * (payment.songQty ?? 1);
  const amount = cents > 0 && currency ? formatMoney(cents, currency) : null;
  const href = payment.projectId
    ? `/dashboard/clients-projects/${payment.projectId}`
    : "/dashboard/clients-projects";

  function dismiss() {
    setError(null);
    if (!online) {
      setError("Reconnect to dismiss this payment notice.");
      return;
    }
    setHidden(true);
    startTransition(async () => {
      try {
        const result = await acknowledgePaymentAction({ bookingId: payment.id });
        if (result.ok) return;
        setHidden(false);
        setError(result.error);
      } catch {
        setHidden(false);
        setError("Couldn't dismiss — please try again.");
      }
    });
  }

  return (
    <li className="border-b border-[rgb(var(--fg-onsidebar)/0.16)] last:border-b-0 lg:border-[rgb(var(--border-subtle))]">
      <div className="flex min-h-[72px] min-w-0 items-center gap-3 py-3 lg:min-h-[68px] lg:py-2.5">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-[rgb(var(--brand-primary)/0.45)] text-[rgb(var(--brand-primary))] lg:h-9 lg:w-9 lg:border-[rgb(var(--brand-primary-text)/0.5)] lg:text-[rgb(var(--brand-primary-text))]">
          <CheckCircle2 aria-hidden size={19} strokeWidth={2} />
        </span>
        <div className="min-w-0 flex-1">
          <span className="block truncate text-[15px] font-bold text-[rgb(var(--fg-onsidebar))] lg:text-[rgb(var(--fg-default))]">
            Payment received
          </span>
          <span className="mt-0.5 block truncate text-[12.5px] text-[rgb(var(--fg-onsidebar)/0.62)] lg:text-[rgb(var(--fg-muted))]">
            {payment.artistName} · {payment.projectName}
            {amount ? ` · ${amount}` : ""}
          </span>
        </div>
        <Link
          href={href}
          aria-label={`Open project: ${payment.projectName} for ${payment.artistName}`}
          className="sk-press inline-flex h-11 shrink-0 items-center justify-center rounded-[var(--radius-lg)] border border-[rgb(var(--fg-onsidebar)/0.34)] px-3 text-sm font-semibold text-[rgb(var(--fg-onsidebar))] focus-visible:ring-2 focus-visible:ring-[rgb(var(--focus-ring))] focus-visible:outline-none lg:h-10 lg:rounded-[var(--radius-md)] lg:border-[rgb(var(--border-strong))] lg:text-[rgb(var(--fg-default))]"
        >
          <span className="lg:hidden">Open</span>
          <span className="hidden lg:inline">Open project</span>
        </Link>
        <button
          type="button"
          onClick={dismiss}
          disabled={pending}
          aria-label={`Dismiss payment received from ${payment.artistName} for ${payment.projectName}`}
          className="sk-press flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-[rgb(var(--fg-onsidebar)/0.6)] hover:bg-[rgb(var(--fg-onsidebar)/0.08)] focus-visible:ring-2 focus-visible:ring-[rgb(var(--focus-ring))] focus-visible:outline-none disabled:opacity-50 lg:h-9 lg:w-9 lg:text-[rgb(var(--fg-muted))] lg:hover:bg-[rgb(var(--bg-overlay))]"
        >
          <X aria-hidden size={15} />
        </button>
      </div>
      {error ? (
        <p
          role="alert"
          className="mb-2 rounded-[var(--radius-sm)] bg-[rgb(var(--fg-danger)/0.1)] px-3 py-2 text-xs text-[rgb(var(--fg-danger-text))]"
        >
          {error}
        </p>
      ) : null}
    </li>
  );
}
