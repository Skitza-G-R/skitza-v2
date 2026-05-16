// Setup → Services tab content. Lifted from /dashboard/booking?tab=
// packages so the producer's services CRUD lives directly inside the
// Setup tab instead of behind a "Manage services" cross-link button.
//
// Server component — no local state, just renders the toolbar + the
// row grid. PackageToolbar / EditPackageButton / DeactivatePackageButton
// are the client islands that own the interactive bits; this wrapper
// keeps them out of the client bundle when the producer hasn't landed
// on the Services tab.
//
// The Booking page (/dashboard/booking?tab=packages) imports this same
// component so the two surfaces never drift visually. The section
// header is owned by the page now (settings/page.tsx renders the
// dynamic per-tab H1), so this component renders content only.

import type { PaymentPlan } from "@skitza/db";

import { Badge } from "~/components/ui/badge";
import { EmptyState } from "~/components/ui/empty-state";

import { DeactivatePackageButton } from "~/app/(producer)/dashboard/booking/package-form";
import { EditPackageButton } from "~/app/(producer)/dashboard/booking/edit-product-client";
import { PackageToolbar } from "~/app/(producer)/dashboard/booking/package-toolbar";
import {
  CURRENCY_SYMBOL,
  type Currency,
  type InitialPackageValues,
} from "~/app/(producer)/dashboard/booking/package-form";

export type ServicePackageRow = {
  id: string;
  name: string;
  description: string | null;
  durationMin: number;
  sessionCount: number;
  priceCents: number;
  currency: string;
  depositPct: number;
  active: boolean;
  kind: string;
  locationType: string;
  bufferMinutes: number;
  minLeadHours: number;
  paymentPlans: PaymentPlan[];
  contractUrl: string | null;
};

const KIND_LABEL: Record<string, string> = {
  session: "Session",
  mixing: "Mixing",
  mastering: "Mastering",
  producing: "Producing",
  other: "Other",
};

const LOCATION_LABEL: Record<string, string> = {
  studio: "In studio",
  remote: "Remote",
  client_space: "Their space",
};

// DB returns loose `string` for a few enum-backed columns. Narrow here
// so the InitialPackageValues passed to the client component stays
// tight. Unknown values fall back to the same defaults NewPackageForm
// uses for create — safe because the form will immediately overwrite
// them on submit if the producer touched the field.
const VALID_CURRENCIES = ["USD", "EUR", "GBP", "ILS"] as const;
const VALID_KINDS = ["session", "mixing", "mastering", "producing", "other"] as const;
const VALID_LOCATIONS = ["studio", "remote", "client_space"] as const;

type InitCurrency = InitialPackageValues["currency"];
type InitKind = InitialPackageValues["kind"];
type InitLocation = InitialPackageValues["locationType"];

function toInitialValues(p: ServicePackageRow): InitialPackageValues {
  const currency = (VALID_CURRENCIES as readonly string[]).includes(p.currency)
    ? (p.currency as InitCurrency)
    : "USD";
  const kind = (VALID_KINDS as readonly string[]).includes(p.kind)
    ? (p.kind as InitKind)
    : "session";
  const locationType = (VALID_LOCATIONS as readonly string[]).includes(p.locationType)
    ? (p.locationType as InitLocation)
    : "studio";
  return {
    id: p.id,
    name: p.name,
    description: p.description,
    durationMin: p.durationMin,
    sessionCount: p.sessionCount,
    priceCents: p.priceCents,
    currency,
    depositPct: p.depositPct,
    kind,
    locationType,
    bufferMinutes: p.bufferMinutes,
    minLeadHours: p.minLeadHours,
    paymentPlans: p.paymentPlans,
    contractUrl: p.contractUrl,
  };
}

function formatMoney(cents: number, currency: string): string {
  if (cents === 0) return "Free";
  const dollars = cents / 100;
  const known = (CURRENCY_SYMBOL as Record<string, string | undefined>)[currency];
  const prefix = known ?? `${currency} `;
  return `${prefix}${dollars.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

export function ServicesSection({
  packages,
  defaultCurrency,
}: {
  packages: ServicePackageRow[];
  // Producer's profile-level default currency, threaded down to the
  // toolbar's New-service form so an Israeli producer sees ILS pre-
  // selected instead of USD.
  defaultCurrency: Currency;
}) {
  return (
    <div className="space-y-6">
      <div>
        <PackageToolbar defaultCurrency={defaultCurrency} />
      </div>
      {packages.length === 0 ? (
        <EmptyState
          icon={<CalendarIcon />}
          title="Your bookable services live here."
          description="A service is one offering — a mixing session, a mastering run, a production day. Visitors pick a service first, then a time slot."
          className="min-h-[40vh] justify-center"
        />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {packages.map((p) => (
            <li
              key={p.id}
              className={[
                "relative rounded-[var(--radius-lg)] border bg-[rgb(var(--bg-elevated))] p-5 transition-colors",
                p.active
                  ? "border-[rgb(var(--border-subtle))]"
                  : "border-dashed border-[rgb(var(--border-subtle))] opacity-60",
              ].join(" ")}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-display text-xl tracking-tight" style={{ fontWeight: 700 }}>
                      {p.name}
                    </h3>
                    <span className="inline-flex items-center rounded-[var(--radius-lg)] bg-[rgb(var(--fg-muted)/0.15)] px-2 py-0.5 text-[0.66rem] font-medium uppercase tracking-wider text-[rgb(var(--fg-secondary))]">
                      {KIND_LABEL[p.kind] ?? p.kind}
                    </span>
                    <span className="inline-flex items-center rounded-[var(--radius-lg)] bg-[rgb(var(--brand-primary)/0.12)] px-2 py-0.5 text-[0.66rem] font-medium uppercase tracking-wider text-[rgb(var(--brand-primary))]">
                      {LOCATION_LABEL[p.locationType] ?? p.locationType}
                    </span>
                  </div>
                  {p.description ? (
                    <p className="mt-1 text-sm text-[rgb(var(--fg-secondary))] line-clamp-2">
                      {p.description}
                    </p>
                  ) : null}
                </div>
                {p.active ? null : <Badge>Archived</Badge>}
              </div>
              <div className="mt-4 flex flex-wrap items-baseline gap-x-4 gap-y-1">
                <span
                  className="sk-num font-display text-2xl leading-none text-[rgb(var(--brand-primary))]"
                  style={{ fontWeight: 800 }}
                >
                  {formatMoney(p.priceCents, p.currency)}
                </span>
                <span className="sk-num font-mono text-xs text-[rgb(var(--fg-muted))]">
                  {p.durationMin}min · {p.sessionCount} session{p.sessionCount === 1 ? "" : "s"}
                </span>
                {p.depositPct > 0 ? (
                  <span className="sk-num font-mono text-xs text-[rgb(var(--fg-secondary))]">
                    {String(p.depositPct)}% deposit
                  </span>
                ) : null}
              </div>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[0.66rem] uppercase tracking-wider text-[rgb(var(--fg-muted))]">
                {p.bufferMinutes > 0 ? (
                  <span>Buffer: {String(p.bufferMinutes)} min</span>
                ) : null}
                <span>Min notice: {String(p.minLeadHours)}h</span>
              </div>
              {p.active ? (
                <div className="mt-4 flex justify-end gap-1">
                  <EditPackageButton values={toInitialValues(p)} />
                  <DeactivatePackageButton id={p.id} name={p.name} />
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function CalendarIcon() {
  return (
    <svg
      aria-hidden
      width="20"
      height="20"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="2" y="3" width="12" height="11" rx="1.5" />
      <path d="M2 6.5h12M5 1.75V4M11 1.75V4" />
    </svg>
  );
}
