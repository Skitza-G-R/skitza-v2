"use client";

import { type SyntheticEvent, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button } from "~/components/ui/button";
import { Input, Label, Select } from "~/components/ui/input";
import { useToast } from "~/components/ui/toast";
import { createPackage, deactivatePackage } from "./actions";

type Currency = "USD" | "EUR" | "GBP" | "ILS";

const CURRENCY_SYMBOL: Record<Currency, string> = {
  USD: "$",
  EUR: "€",
  GBP: "£",
  ILS: "₪",
};

export function NewPackageForm({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [durationMin, setDurationMin] = useState(60);
  const [sessionCount, setSessionCount] = useState(1);
  const [priceDollars, setPriceDollars] = useState(150);
  const [currency, setCurrency] = useState<Currency>("USD");
  const [depositPct, setDepositPct] = useState(25);

  function onSubmit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const res = await createPackage({
        name: name.trim(),
        ...(description.trim() ? { description: description.trim() } : {}),
        durationMin,
        sessionCount,
        // Store as cents so Stripe integration later doesn't need
        // a migration dance.
        priceCents: Math.round(priceDollars * 100),
        currency,
        depositPct,
      });
      if (res.ok) {
        toast(`"${name.trim()}" package created.`, "success");
        onClose();
        router.refresh();
      } else {
        setError(res.error);
        toast(res.error, "error");
      }
    });
  }

  return (
    <form
      onSubmit={onSubmit}
      className="rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-5 reveal-up"
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Label htmlFor="name">Package name</Label>
          <Input
            id="name"
            type="text"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
            }}
            placeholder="Full Production"
            required
            maxLength={80}
            autoFocus
          />
        </div>
        <div className="sm:col-span-2">
          <Label htmlFor="description">Description (optional)</Label>
          <Input
            id="description"
            type="text"
            value={description}
            onChange={(e) => {
              setDescription(e.target.value);
            }}
            placeholder="Beat, tracking, and mix. 4 sessions over 6 weeks."
            maxLength={500}
          />
        </div>
        <div>
          <Label htmlFor="duration">Session length (minutes)</Label>
          <Input
            id="duration"
            type="number"
            min={15}
            max={24 * 60}
            step={15}
            value={durationMin}
            onChange={(e) => {
              setDurationMin(Number(e.target.value));
            }}
            required
          />
        </div>
        <div>
          <Label htmlFor="sessions">Sessions included</Label>
          <Input
            id="sessions"
            type="number"
            min={1}
            max={100}
            value={sessionCount}
            onChange={(e) => {
              setSessionCount(Number(e.target.value));
            }}
            required
          />
        </div>
        <div>
          <Label htmlFor="price">Price ({CURRENCY_SYMBOL[currency]})</Label>
          <Input
            id="price"
            type="number"
            min={0}
            step={1}
            value={priceDollars}
            onChange={(e) => {
              setPriceDollars(Number(e.target.value));
            }}
            required
          />
          <p className="mt-1.5 text-xs text-[rgb(var(--fg-muted))]">
            Use 0 for free discovery sessions.
          </p>
        </div>
        <div>
          <Label htmlFor="currency">Currency</Label>
          <Select
            id="currency"
            value={currency}
            onChange={(e) => {
              setCurrency(e.target.value as Currency);
            }}
          >
            <option value="USD">USD · $</option>
            <option value="EUR">EUR · €</option>
            <option value="GBP">GBP · £</option>
            <option value="ILS">ILS · ₪</option>
          </Select>
        </div>
        <div className="sm:col-span-2">
          <Label htmlFor="deposit">Deposit percent</Label>
          <Input
            id="deposit"
            type="number"
            min={0}
            max={100}
            step={5}
            value={depositPct}
            onChange={(e) => {
              setDepositPct(Number(e.target.value));
            }}
            required
          />
          <p className="mt-1.5 text-xs text-[rgb(var(--fg-muted))]">
            Collected at booking. 0% = pay in full later. Stripe integration lands in Phase C.
          </p>
        </div>
      </div>

      {error ? (
        <p role="alert" className="mt-3 text-sm text-[rgb(var(--fg-danger))]">
          {error}
        </p>
      ) : null}

      <div className="mt-5 flex gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save package"}
        </Button>
        <Button type="button" variant="ghost" onClick={onClose} disabled={pending}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

export function DeactivatePackageButton({
  id,
  name,
}: {
  id: string;
  name: string;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [confirm, setConfirm] = useState(false);

  function onGo() {
    startTransition(async () => {
      const res = await deactivatePackage({ id });
      if (res.ok) {
        toast(`"${name}" archived.`, "success");
        router.refresh();
      } else {
        toast(res.error, "error");
      }
    });
  }

  if (!confirm) {
    return (
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => {
          setConfirm(true);
        }}
      >
        Archive
      </Button>
    );
  }
  return (
    <div className="inline-flex items-center gap-1">
      <Button type="button" variant="destructive" size="sm" onClick={onGo} disabled={pending}>
        {pending ? "Archiving…" : "Confirm"}
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => {
          setConfirm(false);
        }}
        disabled={pending}
      >
        Cancel
      </Button>
    </div>
  );
}

export { CURRENCY_SYMBOL };
