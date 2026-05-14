"use client";

import { type SyntheticEvent, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { PaymentPlan } from "@skitza/db";

import { Button } from "~/components/ui/button";
import { Input, Label, Select, Textarea } from "~/components/ui/input";
import { useToast } from "~/components/ui/toast";
import {
  ValidationHint,
  validateDisplayName,
  validateNumber,
  type ValidationState,
} from "~/components/ui/validation";
import {
  createPackage,
  deactivatePackage,
  updatePackage,
  type PackageKind,
  type PackageLocationType,
} from "./actions";
import { parsePaymentPlansFromFormData } from "./payment-plans-parser";

export type Currency = "USD" | "EUR" | "GBP" | "ILS";

// Shape a producer-owned product takes when we pre-fill the form for
// editing. All fields are required here because the caller has already
// read a row from the DB — defaults only matter for the CREATE path.
export type InitialPackageValues = {
  id: string;
  name: string;
  description: string | null;
  durationMin: number;
  sessionCount: number;
  priceCents: number;
  currency: Currency;
  depositPct: number;
  kind: PackageKind;
  locationType: PackageLocationType;
  bufferMinutes: number;
  minLeadHours: number;
  paymentPlans?: PaymentPlan[];
  // B7 — optional contract PDF URL the producer hosts elsewhere
  // (Dropbox, Drive, their own site). Same paste-a-link pattern as
  // brand.logoUrl.
  contractUrl: string | null;
};

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

export function NewPackageForm({
  onClose,
  initialPlans = [{ kind: "full" }],
  initialValues,
  fromTemplate = false,
  hideDepositField = false,
  initialCurrency,
}: {
  onClose: () => void;
  initialPlans?: PaymentPlan[];
  // When supplied, the form operates in EDIT mode — fields are
  // pre-populated, submit dispatches `updatePackage({ id, ... })`,
  // and the initialPlans default is overridden by whatever plans the
  // product was saved with.
  initialValues?: InitialPackageValues;
  // When true, the "Deposit percent" numeric input is hidden. The
  // Payment plans selector lower in the form (Pay in full / 50-50 /
  // monthly installments) already encodes the upfront-vs-deferred
  // schedule as a structured choice, so showing both was redundant +
  // confusing in the onboarding wizard. depositPct still flows on save
  // (initial value 25 from useState default) — the booking flow uses
  // the chosen payment plan as the source of truth, not depositPct.
  hideDepositField?: boolean;
  // Default currency to seed the dropdown when CREATE mode (no
  // initialValues). Onboarding's Step 2 reads producers.default_currency
  // (which Step 1's completeStudio set from x-vercel-ip-country /
  // accept-language) and passes it here so an Israeli producer doesn't
  // see USD pre-selected when ILS would be the obvious default.
  // Ignored in EDIT mode — the existing row's currency wins.
  initialCurrency?: Currency;
  // When true, initialValues are a template pre-fill (no real row
  // exists in the DB yet). Submit routes through createPackage()
  // instead of updatePackage(); the synthetic id on initialValues is
  // ignored server-side.
  fromTemplate?: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // EDIT mode only fires when we have an existing-row initialValues
  // *and* the template flag isn't set. Templates hydrate the same
  // controlled-input seeds but still create a fresh row on save.
  const isEdit = initialValues !== undefined && !fromTemplate;
  // Prefer plans saved on the product over the caller-provided default.
  const effectiveInitialPlans =
    initialValues?.paymentPlans ?? initialPlans;

  const [name, setName] = useState(initialValues?.name ?? "");
  const [description, setDescription] = useState(
    initialValues?.description ?? "",
  );
  // B7 — contract PDF link (paste-a-URL, no file upload). Empty string
  // collapses to null on submit so producers can clear an existing link
  // by deleting the field's value.
  const [contractUrl, setContractUrl] = useState(
    initialValues?.contractUrl ?? "",
  );
  const [durationMin, setDurationMin] = useState(
    initialValues?.durationMin ?? 60,
  );
  const [sessionCount, setSessionCount] = useState(
    initialValues?.sessionCount ?? 1,
  );
  const [priceDollars, setPriceDollars] = useState(
    initialValues ? initialValues.priceCents / 100 : 150,
  );
  // Currency precedence:
  //   1. initialValues.currency (EDIT mode — the saved row wins)
  //   2. initialCurrency prop (CREATE mode — onboarding seeds the
  //      producer's default currency here so the form matches the
  //      producer's locale without manual override)
  //   3. "USD" final fallback (Setup → Services standalone with no
  //      caller-supplied default)
  const [currency, setCurrency] = useState<Currency>(
    initialValues?.currency ?? initialCurrency ?? "USD",
  );
  const [depositPct, setDepositPct] = useState(
    initialValues?.depositPct ?? 25,
  );
  // Controlled state for each payment-plan checkbox. Pre-checked from
  // saved plans on EDIT, defaults to plan_full for CREATE. Derived
  // `selectedPlan` (below) reads from these — not from "last clicked" —
  // so unchecking a box and ticking multiple plans both behave sanely.
  const [planFullChecked, setPlanFullChecked] = useState(() =>
    effectiveInitialPlans.some((p) => p.kind === "full"),
  );
  const [planSplitChecked, setPlanSplitChecked] = useState(() =>
    effectiveInitialPlans.some((p) => p.kind === "split_50_50"),
  );
  const [planMonthlyChecked, setPlanMonthlyChecked] = useState(() =>
    effectiveInitialPlans.some((p) => p.kind === "monthly"),
  );
  // Active plan for deposit semantics, with priority monthly > split >
  // full. Monthly wins when checked because it's the only plan whose
  // depositPct is producer-configurable; split_50_50 is fixed at 50 and
  // full has no deposit. If the user offers both monthly and split, the
  // saved depositPct is the producer's monthly figure — split's 50% is
  // applied at checkout independently per the booking flow's logic.
  const selectedPlan: "full" | "split_50_50" | "monthly" = planMonthlyChecked
    ? "monthly"
    : planSplitChecked
      ? "split_50_50"
      : "full";
  const [kind, setKind] = useState<PackageKind>(
    initialValues?.kind ?? "session",
  );
  const [locationType, setLocationType] = useState<PackageLocationType>(
    initialValues?.locationType ?? "studio",
  );
  const [bufferMinutes, setBufferMinutes] = useState(
    initialValues?.bufferMinutes ?? 0,
  );
  const [minLeadHours, setMinLeadHours] = useState(
    initialValues?.minLeadHours ?? 12,
  );
  // Touched-bit for the name field so an EDIT form doesn't flash a
  // required error the moment it mounts with a prefilled name.
  const [nameTouched, setNameTouched] = useState(false);

  const nameState: ValidationState = nameTouched
    ? validateDisplayName(name)
    : { kind: "idle" };
  // Duration / price always have a value in the component (number
  // inputs aren't nullable in the underlying state), so we validate
  // them eagerly — the live echo ("≈ $150.00") is the whole point.
  const durationState: ValidationState = validateNumber(durationMin, {
    min: 15,
    max: 24 * 60,
    label: "minutes",
    formatParsed: (n) =>
      n === 60 ? "1 hour" : n % 60 === 0 ? `${String(n / 60)} hours` : `${String(n)} min`,
  });
  const priceState: ValidationState = validateNumber(priceDollars, {
    min: 0,
    label: currency,
    formatParsed: (n) =>
      n === 0
        ? `Free · ${currency}`
        : `${CURRENCY_SYMBOL[currency]}${n.toFixed(2)} ${currency}`,
  });

  function onSubmit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    // Payment-plan checkboxes are uncontrolled — pull them out of the
    // form's FormData at submit time. Parser always returns a non-empty
    // list so the product can never be saved with an empty plan set.
    const paymentPlans = parsePaymentPlansFromFormData(
      new FormData(e.currentTarget),
    );
    // Deposit semantics are derived from the active plan, not the
    // numeric input — full = no deposit, split_50_50 = always 50,
    // monthly = whatever the producer typed.
    const effectiveDepositPct =
      selectedPlan === "full"
        ? 0
        : selectedPlan === "split_50_50"
          ? 50
          : depositPct;
    // B7 — collapse empty-string contract URL to null so producers can
    // clear an existing link, and skip the field entirely when blank on
    // CREATE so we don't send an empty string through z.string().url().
    const trimmedContract = contractUrl.trim();
    const contractField = isEdit
      ? { contractUrl: trimmedContract.length > 0 ? trimmedContract : null }
      : trimmedContract.length > 0
        ? { contractUrl: trimmedContract }
        : {};
    const payload = {
      name: name.trim(),
      ...(description.trim() ? { description: description.trim() } : {}),
      durationMin,
      sessionCount,
      // Store as cents so Stripe integration later doesn't need
      // a migration dance.
      priceCents: Math.round(priceDollars * 100),
      currency,
      depositPct: effectiveDepositPct,
      kind,
      locationType,
      bufferMinutes,
      minLeadHours,
      paymentPlans,
      ...contractField,
    };
    startTransition(async () => {
      const res = isEdit
        ? await updatePackage({ id: initialValues.id, ...payload })
        : await createPackage(payload);
      if (res.ok) {
        toast(
          `"${name.trim()}" ${isEdit ? "updated" : "created"}.`,
          "success",
        );
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
          <Label htmlFor="name">Service name</Label>
          <Input
            id="name"
            type="text"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
            }}
            onBlur={() => {
              setNameTouched(true);
            }}
            placeholder="Full Production"
            required
            maxLength={80}
            autoFocus
            className="text-base"
            aria-invalid={nameState.kind === "invalid" || nameState.kind === "required"}
          />
          <ValidationHint state={nameState} />
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

        <div className="sm:col-span-2">
          <Label htmlFor="contractUrl">Contract PDF link (optional)</Label>
          <Input
            id="contractUrl"
            type="url"
            value={contractUrl}
            onChange={(e) => {
              setContractUrl(e.target.value);
            }}
            placeholder="https://drive.google.com/..."
            maxLength={2048}
            className="text-base"
          />
          <p className="mt-1.5 text-xs text-[rgb(var(--fg-muted))]">
            Paste a public link to your contract PDF (Drive, Dropbox, your site). Leave blank to remove.
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
            aria-invalid={durationState.kind === "invalid"}
          />
          <ValidationHint state={durationState} />
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
            aria-invalid={priceState.kind === "invalid"}
          />
          <ValidationHint
            state={priceState}
            hint="Use 0 for free discovery sessions."
          />
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

        {!hideDepositField && selectedPlan === "monthly" ? (
          <div>
            <Label htmlFor="deposit">Deposit percent (optional)</Label>
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
              className="text-base"
            />
            <p className="mt-1.5 text-xs text-[rgb(var(--fg-muted))]">
              First payment collected at booking. 0% = first installment with the rest.
            </p>
          </div>
        ) : null}

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

      <fieldset className="mt-6 rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] p-4">
        <legend className="px-2 text-xs font-mono uppercase tracking-wider text-[rgb(var(--fg-muted))]">
          Payment plans offered
        </legend>
        <p className="mt-2 text-xs text-[rgb(var(--fg-secondary))]">
          Client picks one at checkout.
        </p>
        <label className="mt-3 flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="plan_full"
            checked={planFullChecked}
            onChange={(e) => {
              setPlanFullChecked(e.target.checked);
            }}
          />
          Pay in full
        </label>
        <label className="mt-2 flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="plan_split"
            checked={planSplitChecked}
            onChange={(e) => {
              setPlanSplitChecked(e.target.checked);
            }}
          />
          50% deposit + 50% on delivery
        </label>
        <label className="mt-2 flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="plan_monthly"
            checked={planMonthlyChecked}
            onChange={(e) => {
              setPlanMonthlyChecked(e.target.checked);
            }}
          />
          Monthly installments —
          <input
            type="number"
            name="plan_monthly_n"
            min={2}
            max={12}
            defaultValue={
              effectiveInitialPlans.find((p) => p.kind === "monthly")?.installments ?? 4
            }
            className="w-16 rounded-sm border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-2 py-1 text-sm"
          />
          payments
        </label>
      </fieldset>

      {error ? (
        <p role="alert" className="mt-3 text-sm text-[rgb(var(--fg-danger))]">
          {error}
        </p>
      ) : null}

      <div className="mt-5 flex flex-wrap gap-2">
        <Button type="submit" disabled={pending} className="min-h-11">
          {pending
            ? "Saving…"
            : isEdit
              ? "Save changes"
              : "Save service"}
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
