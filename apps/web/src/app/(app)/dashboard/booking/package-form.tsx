"use client";

import { type SyntheticEvent, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button } from "~/components/ui/button";
import { Input, Label, Select, Textarea } from "~/components/ui/input";
import { useToast } from "~/components/ui/toast";
import {
  createPackage,
  deactivatePackage,
  type PackageKind,
  type PackageLocationType,
} from "./actions";

type Currency = "USD" | "EUR" | "GBP" | "ILS";

const CURRENCY_SYMBOL: Record<Currency, string> = {
  USD: "$",
  EUR: "€",
  GBP: "£",
  ILS: "₪",
};

// Public-friendly labels for the `kind` dropdown. The on-disk values
// match the PackageKind zod enum in the router.
const KIND_OPTIONS: { value: PackageKind; label: string }[] = [
  { value: "session", label: "Session (generic)" },
  { value: "mixing", label: "Mixing" },
  { value: "mastering", label: "Mastering" },
  { value: "producing", label: "Producing" },
  { value: "other", label: "Other" },
];

// Location options render as a radio because there's only three and a
// radio makes the choice visible without a click. Labels intentionally
// plain-spoken so non-English speakers don't stumble.
const LOCATION_OPTIONS: { value: PackageLocationType; label: string; hint: string }[] = [
  { value: "studio", label: "My studio", hint: "Clients come to you" },
  { value: "remote", label: "Remote", hint: "Zoom / online" },
  { value: "client_space", label: "Their space", hint: "You travel to them" },
];

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
  const [kind, setKind] = useState<PackageKind>("session");
  const [locationType, setLocationType] = useState<PackageLocationType>("studio");
  const [bufferMinutes, setBufferMinutes] = useState(0);
  const [minLeadHours, setMinLeadHours] = useState(12);

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
        kind,
        locationType,
        bufferMinutes,
        minLeadHours,
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
      {/*
        Mobile discipline: single-column at <640px so every input gets
        the full viewport width (no horizontal cramming). sm:grid-cols-2
        kicks in at 640px+. Inputs are text-base (16px) via the shared
        Input component to prevent iOS zoom-on-focus.
      */}
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
            className="text-base"
          />
        </div>

        <div className="sm:col-span-2">
          <Label htmlFor="description">Short description</Label>
          <Textarea
            id="description"
            value={description}
            onChange={(e) => {
              setDescription(e.target.value);
            }}
            placeholder="What the client walks away with, in one sentence."
            maxLength={500}
            rows={2}
            className="text-base"
          />
          <p className="mt-1.5 text-xs text-[rgb(var(--fg-muted))]">
            Shown on your public booking page — keep it short (~140 chars).
          </p>
        </div>

        <div>
          <Label htmlFor="kind">Kind</Label>
          <Select
            id="kind"
            value={kind}
            onChange={(e) => {
              setKind(e.target.value as PackageKind);
            }}
            className="text-base"
          >
            {KIND_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </Select>
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
            className="text-base"
          />
        </div>

        <div className="sm:col-span-2">
          <Label>Location</Label>
          {/*
            Fieldset-style radio group. 44px+ hit target per option so
            fat-fingered mobile taps don't miss.
          */}
          <div className="grid gap-2 sm:grid-cols-3">
            {LOCATION_OPTIONS.map((o) => {
              const active = locationType === o.value;
              return (
                <label
                  key={o.value}
                  className={[
                    "flex min-h-[44px] cursor-pointer items-start gap-3 rounded-[var(--radius-md)] border px-3 py-3 transition-colors",
                    active
                      ? "border-[rgb(var(--brand-primary))] bg-[rgb(var(--brand-primary)/0.08)]"
                      : "border-[rgb(var(--border-subtle))] hover:border-[rgb(var(--border-strong))]",
                  ].join(" ")}
                >
                  <input
                    type="radio"
                    name="locationType"
                    value={o.value}
                    checked={active}
                    onChange={() => {
                      setLocationType(o.value);
                    }}
                    className="mt-0.5 h-4 w-4 accent-[rgb(var(--brand-primary))]"
                  />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-[rgb(var(--fg-primary))]">{o.label}</span>
                    <span className="block text-xs text-[rgb(var(--fg-muted))]">{o.hint}</span>
                  </span>
                </label>
              );
            })}
          </div>
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
            className="text-base"
          />
          <p className="mt-1.5 text-xs text-[rgb(var(--fg-muted))]">
            Use {">"} 1 for session-packs (e.g. &ldquo;3-pack&rdquo;, &ldquo;10-pack&rdquo;).
          </p>
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
            className="text-base"
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
            className="text-base"
          >
            <option value="USD">USD · $</option>
            <option value="EUR">EUR · €</option>
            <option value="GBP">GBP · £</option>
            <option value="ILS">ILS · ₪</option>
          </Select>
        </div>

        <div>
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
            className="text-base"
          />
          <p className="mt-1.5 text-xs text-[rgb(var(--fg-muted))]">
            Collected at booking. 0% = pay in full later.
          </p>
        </div>

        <div>
          <Label htmlFor="buffer">Buffer between sessions (min)</Label>
          <Input
            id="buffer"
            type="number"
            min={0}
            max={240}
            step={5}
            value={bufferMinutes}
            onChange={(e) => {
              setBufferMinutes(Number(e.target.value));
            }}
            required
            className="text-base"
          />
          <p className="mt-1.5 text-xs text-[rgb(var(--fg-muted))]">
            Time you need between back-to-back bookings (cleanup, break).
          </p>
        </div>

        <div>
          <Label htmlFor="minLead">Min. notice (hours)</Label>
          <Input
            id="minLead"
            type="number"
            min={0}
            max={30 * 24}
            step={1}
            value={minLeadHours}
            onChange={(e) => {
              setMinLeadHours(Number(e.target.value));
            }}
            required
            className="text-base"
          />
          <p className="mt-1.5 text-xs text-[rgb(var(--fg-muted))]">
            How far ahead clients must book. 12h is a safe default.
          </p>
        </div>
      </div>

      {error ? (
        <p role="alert" className="mt-3 text-sm text-[rgb(var(--fg-danger))]">
          {error}
        </p>
      ) : null}

      <div className="mt-5 flex flex-wrap gap-2">
        <Button type="submit" disabled={pending} className="min-h-11">
          {pending ? "Saving…" : "Save package"}
        </Button>
        <Button type="button" variant="ghost" onClick={onClose} disabled={pending} className="min-h-11">
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
