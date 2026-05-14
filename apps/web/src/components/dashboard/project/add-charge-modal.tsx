"use client";

// Manual charge entry — opened from the Money sub-tab's "+ Add charge"
// CTA. Inserts a row directly into the invoices ledger with status
// 'sent' so it lands in the Outstanding bucket on the money strip.
// No Stripe round-trip; this is a manual record-keeping path for
// producers reconciling out-of-band payments.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "~/components/ui/button";
import { Input, Label } from "~/components/ui/input";
import { useToast } from "~/components/ui/toast";
import { addProjectInvoice } from "~/app/(producer)/dashboard/clients-projects/actions";

interface AddChargeModalProps {
  open: boolean;
  projectId: string;
  defaultCurrency: string;
  onClose: () => void;
}

export function AddChargeModal({
  open,
  projectId,
  defaultCurrency,
  onClose,
}: AddChargeModalProps) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState(defaultCurrency);
  const [description, setDescription] = useState("");

  useEffect(() => {
    if (open) {
      setAmount("");
      setCurrency(defaultCurrency);
      setDescription("");
      setError(null);
    }
  }, [open, defaultCurrency]);

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

  // Parse amount as major units (e.g. "120.50" → 12050 cents). A
  // bad-format value collapses to 0 here; `valid` then trips the
  // `> 0` guard so we never submit a zero-dollar charge. Server
  // re-validates positivity + integer cents either way.
  const trimmedAmount = amount.trim();
  const parsedCents = /^\d+(\.\d{1,2})?$/.test(trimmedAmount)
    ? Math.round(parseFloat(trimmedAmount) * 100)
    : 0;
  const trimmedDescription = description.trim();
  const trimmedCurrency = currency.trim().toUpperCase();
  const valid =
    parsedCents > 0 &&
    trimmedDescription.length > 0 &&
    trimmedDescription.length <= 280 &&
    /^[A-Z]{3}$/.test(trimmedCurrency);

  async function onSave() {
    if (!valid || pending) return;
    setPending(true);
    setError(null);
    const res = await addProjectInvoice({
      projectId,
      amountCents: parsedCents,
      currency: trimmedCurrency,
      description: trimmedDescription,
    });
    setPending(false);
    if (res.ok) {
      toast("Charge added.", "success");
      router.refresh();
      onClose();
    } else {
      setError(res.error);
      toast(res.error, "error");
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="add-charge-title"
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
      <div className="sk-pop-center relative w-full max-w-md rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-6 shadow-2xl">
        <h2
          id="add-charge-title"
          className="font-display text-xl text-[rgb(var(--fg-primary))]"
          style={{ fontWeight: 700 }}
        >
          Add a charge
        </h2>
        <p className="mt-2 text-sm text-[rgb(var(--fg-secondary))]">
          Record a service or charge to add to this project&rsquo;s outstanding balance.
        </p>

        <div className="mt-5 space-y-4">
          <div className="grid gap-4 sm:grid-cols-[1fr_120px]">
            <div>
              <Label htmlFor="charge-amount">Amount</Label>
              <Input
                id="charge-amount"
                type="text"
                inputMode="decimal"
                value={amount}
                onChange={(e) => {
                  setAmount(e.target.value);
                }}
                placeholder="120.00"
                disabled={pending}
                autoFocus
              />
            </div>
            <div>
              <Label htmlFor="charge-currency">Currency</Label>
              <Input
                id="charge-currency"
                type="text"
                value={currency}
                onChange={(e) => {
                  setCurrency(e.target.value.toUpperCase());
                }}
                maxLength={3}
                disabled={pending}
              />
            </div>
          </div>
          <div>
            <Label htmlFor="charge-description">Description</Label>
            <Input
              id="charge-description"
              type="text"
              value={description}
              onChange={(e) => {
                setDescription(e.target.value);
              }}
              maxLength={280}
              placeholder="Mixing — additional revisions"
              disabled={pending}
            />
          </div>
        </div>

        {error ? (
          <div
            role="alert"
            className="mt-4 rounded-[var(--radius-md)] border border-[rgb(var(--fg-danger)/0.4)] bg-[rgb(var(--fg-danger)/0.08)] px-3 py-2"
          >
            <p className="text-sm text-[rgb(var(--fg-danger))]">{error}</p>
          </div>
        ) : null}

        <div className="mt-6 flex flex-wrap justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button
            type="button"
            onClick={() => {
              void onSave();
            }}
            disabled={!valid || pending}
          >
            {pending ? "Saving…" : "Add charge"}
          </Button>
        </div>
      </div>
    </div>
  );
}
