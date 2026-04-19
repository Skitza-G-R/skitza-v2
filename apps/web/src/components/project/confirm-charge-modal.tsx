"use client";

// Confirm-charge modal — producer clicks "Mark final delivered" on a
// split_50_50 project with deposit paid; this intercepts to surface the
// exact amount + card tail before firing the off-session PaymentIntent.
//
// The mutation (project.chargeFinal) is the only place the actual
// charge happens; this component's job is consent + error rendering.
// Stripe declines (insufficient funds, expired card) arrive as plain
// Error messages from the mutation — we render them inline so the
// producer can act on them without guessing.

import { useEffect, useState, type ReactNode } from "react";

import { Button } from "~/components/ui/button";

interface ConfirmChargeModalProps {
  open: boolean;
  clientName: string;
  amountCents: number;
  currency: string;
  cardLast4?: string;
  /** Fires the charge. Must throw on failure so the modal can surface the error inline. */
  onConfirm: () => Promise<void>;
  onClose: () => void;
}

function formatAmount(cents: number, currency: string): string {
  // Matches plan-picker's format — minimumFractionDigits: 0 so whole
  // amounts like $100 render clean, maximumFractionDigits: 2 so odd-
  // cent totals ($100.50) still show the pennies accurately.
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

export function ConfirmChargeModal({
  open,
  clientName,
  amountCents,
  currency,
  cardLast4,
  onConfirm,
  onClose,
}: ConfirmChargeModalProps) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Clear inline error when the modal is re-opened so a second attempt
  // doesn't show stale decline text.
  useEffect(() => {
    if (open) setError(null);
  }, [open]);

  // Escape closes (only when idle — we don't want to abandon a charge
  // mid-request; Stripe has already received the call).
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !pending) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [open, pending, onClose]);

  if (!open) return null;

  async function handleConfirm() {
    setPending(true);
    setError(null);
    try {
      await onConfirm();
      setPending(false);
    } catch (err) {
      // Surface the raw message — Stripe's text ("Your card was
      // declined", "Insufficient funds") is actionable. Generic
      // wrappers like "Something went wrong" aren't.
      setError(err instanceof Error ? err.message : "Charge failed.");
      setPending(false);
    }
  }

  const amountFormatted = formatAmount(amountCents, currency);

  const cardFragment: ReactNode = cardLast4
    ? ` ending ${cardLast4}`
    : "";

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-charge-title"
      className="fixed inset-0 z-[60] flex items-center justify-center p-4"
    >
      <button
        type="button"
        aria-label="Close"
        onClick={() => {
          if (!pending) onClose();
        }}
        disabled={pending}
        className="absolute inset-0 bg-black/40 backdrop-blur-sm disabled:cursor-not-allowed"
      />
      <div className="relative w-full max-w-md rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-6 shadow-2xl">
        <h2
          id="confirm-charge-title"
          className="font-display text-xl text-[rgb(var(--fg-primary))]"
          style={{ fontWeight: 700 }}
        >
          Charge {clientName} the final?
        </h2>
        <p className="mt-3 text-sm leading-relaxed text-[rgb(var(--fg-secondary))]">
          We&rsquo;ll charge their card{cardFragment} for{" "}
          <strong className="font-semibold text-[rgb(var(--fg-primary))]">
            {amountFormatted}
          </strong>{" "}
          right now. The artist will get access to download the final mix.
        </p>

        {error ? (
          <div
            role="alert"
            className="mt-4 rounded-[var(--radius-md)] border border-[rgb(var(--fg-danger)/0.4)] bg-[rgb(var(--fg-danger)/0.08)] px-3 py-2"
          >
            <p className="text-sm text-[rgb(var(--fg-danger))]">{error}</p>
          </div>
        ) : null}

        <div className="mt-6 flex flex-wrap justify-end gap-2">
          <Button
            type="button"
            variant="ghost"
            onClick={onClose}
            disabled={pending}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={() => {
              void handleConfirm();
            }}
            disabled={pending}
          >
            {pending ? "Charging…" : "Charge now"}
          </Button>
        </div>
      </div>
    </div>
  );
}
