"use client";

import { useState, useTransition } from "react";

import { Button } from "~/components/ui/button";
import { useToast } from "~/components/ui/toast";

// Task 10 — Paused-state client banner.
//
// Renders at the top of the client-facing project surface when the
// project's stage is `payment_paused` (Stripe ran out of automatic
// retries on a monthly installment). The banner is intentionally NOT
// dismissible — paused is a blocking condition, hiding it would mask
// real info the client needs to act on.
//
// Music + past mixes still render below; only NEW booking/session
// requests are rejected server-side (see `booking.publicRequest`). So
// the client can keep listening while they sort their card out.
//
// The "Update payment method" CTA hits a tRPC mutation that mints a
// Stripe Customer Portal session URL and we redirect the browser to it.
// Stripe's Portal is the canonical place for clients to manage their
// saved card; once they update it, Stripe's auto-retry on the failed
// invoice resolves the paused state via `invoice.paid` webhook handler.
export interface PausedBannerProps {
  // tRPC mutation runner. Lifted to a callback so the banner stays a
  // pure presentational component — the page wires up the actual tRPC
  // call. Returns the Stripe-hosted Portal URL we should redirect to.
  onRequestPortal: () => Promise<{ url: string }>;
}

export function PausedBanner({ onRequestPortal }: PausedBannerProps) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const { toast } = useToast();

  const handleClick = () => {
    setError(null);
    startTransition(async () => {
      try {
        const { url } = await onRequestPortal();
        // Full-page navigation — Stripe's Portal lives on a different
        // origin and the client returns to /share/<token> when done.
        window.location.href = url;
      } catch (err) {
        const message =
          err instanceof Error
            ? err.message
            : "Couldn't open payment method update right now. Try again in a moment.";
        setError(message);
        toast(message, "error");
      }
    });
  };

  return (
    <aside
      role="alert"
      aria-label="Payment paused"
      className="sticky top-0 z-30 mb-6 rounded-[var(--radius-lg)] border border-[rgb(var(--fg-warning)/0.4)] bg-[rgb(var(--fg-warning)/0.1)] p-4 sm:p-5 backdrop-blur"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3">
          <span
            aria-hidden
            className="mt-0.5 inline-flex h-6 w-6 flex-none items-center justify-center rounded-full bg-[rgb(var(--fg-warning)/0.2)] text-[rgb(var(--fg-warning))]"
          >
            {/* warning glyph — keeps the banner readable even with CSS off */}
            <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden focusable="false">
              <path
                d="M12 4l9 16H3L12 4zm0 5v6m0 2v.5"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
          <div className="space-y-1 text-sm">
            <p className="font-semibold text-[rgb(var(--fg-warning))]">
              Your last payment didn&apos;t go through.
            </p>
            <p className="text-[rgb(var(--fg-secondary))]">
              Update your card to continue booking sessions. Music and past
              mixes are still accessible below.
            </p>
            {error ? (
              <p className="text-xs text-[rgb(var(--fg-danger))]">{error}</p>
            ) : null}
          </div>
        </div>

        <div className="flex flex-none items-center sm:pl-3">
          <Button
            type="button"
            variant="default"
            size="sm"
            onClick={handleClick}
            disabled={pending}
          >
            {pending ? "Opening…" : "Update payment method →"}
          </Button>
        </div>
      </div>
    </aside>
  );
}
