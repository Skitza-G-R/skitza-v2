import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import type { PaymentPlan } from "@skitza/db";

import { AppShell } from "~/components/shell/app-shell";
import { Badge } from "~/components/ui/badge";
import { EmptyState } from "~/components/ui/empty-state";
import { appRouter } from "~/server/trpc/routers/_app";
import { AvailabilityEditor } from "./availability-editor";
import { BlackoutsEditor } from "./blackouts-editor";
import { BookingActionButtons } from "./booking-controls";
import { DurationPicker } from "./duration-picker";
import { EditPackageButton } from "./edit-product-client";
import { PoliciesEditor } from "./policies-editor";
import {
  CURRENCY_SYMBOL,
  DeactivatePackageButton,
  type InitialPackageValues,
} from "./package-form";
import { PackageToolbar } from "./package-toolbar";

type Tab = "packages" | "availability" | "requests" | "upcoming";

// Tab state lives in URL search params so producers can share links
// to e.g. /dashboard/booking?tab=availability directly.
type PageProps = { searchParams: Promise<Record<string, string | string[] | undefined>> };

const dateFmt = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

function formatMoney(cents: number, currency: string): string {
  if (cents === 0) return "Free";
  const dollars = cents / 100;
  // currency may be any of the ISO codes we accept. Look up a symbol
  // if it's a known one; otherwise render the code itself ("CHF 120").
  const known = (CURRENCY_SYMBOL as Record<string, string | undefined>)[currency];
  const prefix = known ?? `${currency} `;
  return `${prefix}${dollars.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

function coerceTab(raw: unknown): Tab {
  if (raw === "packages" || raw === "availability" || raw === "requests" || raw === "upcoming") {
    return raw;
  }
  return "packages";
}

export default async function BookingPage({ searchParams }: PageProps) {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const sp = await searchParams;
  const tab = coerceTab(sp.tab);

  const caller = appRouter.createCaller({ userId });
  const [
    packagesList,
    availabilityBlocks,
    blackouts,
    pendingBookings,
    confirmedBookings,
    availabilitySettings,
  ] = await Promise.all([
    caller.booking.packages.list(),
    caller.booking.availability.list(),
    caller.booking.blackouts.list(),
    caller.booking.list({ status: "pending" }),
    caller.booking.list({ status: "confirmed" }),
    caller.booking.availability.getSettings(),
  ]);

  return (
    <AppShell active="projects">
      <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6 sm:py-14">
        <header className="reveal-up">
          <p className="font-mono text-[0.72rem] uppercase tracking-[0.18em] text-[rgb(var(--fg-muted))]">
            Booking
          </p>
          <h1
            className="mt-2 font-display text-4xl leading-tight tracking-tight sm:text-5xl"
            style={{ fontWeight: 800 }}
          >
            Your storefront.
          </h1>
          <p className="mt-3 max-w-xl text-sm text-[rgb(var(--fg-secondary))]">
            Packages you sell, hours you&apos;re open, sessions clients want. One link
            drives all three.
          </p>
        </header>

        {/* Tab nav */}
        <nav
          aria-label="Booking sections"
          className="sk-scroll-x mt-8 flex gap-1 overflow-x-auto border-b border-[rgb(var(--border-subtle))] pb-px"
        >
          {(
            [
              { key: "packages", label: "Packages", count: packagesList.length, dot: false },
              { key: "availability", label: "Availability", count: availabilityBlocks.length, dot: false },
              { key: "requests", label: "Requests", count: pendingBookings.length, dot: pendingBookings.length > 0 },
              { key: "upcoming", label: "Upcoming", count: confirmedBookings.length, dot: false },
            ] satisfies readonly { key: Tab; label: string; count: number; dot: boolean }[]
          ).map((t) => {
            const active = tab === t.key;
            return (
              <Link
                key={t.key}
                href={`/dashboard/booking?tab=${t.key}`}
                aria-current={active ? "page" : undefined}
                className={[
                  // min-h-[44px] on mobile → drops to min-h-0 + py-2 on
                  // desktop where the 4-tab rail stays dense. rounded-t-sm
                  // keeps the focus-visible ring clipped to each tab.
                  "flex min-h-[44px] items-center gap-2 whitespace-nowrap rounded-t-sm px-4 py-2 text-sm transition-colors sm:min-h-0",
                  "border-b-2",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[rgb(var(--brand-primary))]",
                  active
                    ? "border-[rgb(var(--brand-primary))] text-[rgb(var(--fg-primary))] font-semibold"
                    : "border-transparent text-[rgb(var(--fg-secondary))] hover:text-[rgb(var(--fg-primary))]",
                ].join(" ")}
              >
                {t.label}
                {t.count > 0 ? (
                  <span className="sk-num font-mono text-xs text-[rgb(var(--fg-muted))]">
                    {t.count}
                  </span>
                ) : null}
                {t.dot ? (
                  <span
                    aria-hidden
                    className="h-1.5 w-1.5 rounded-full bg-[rgb(var(--brand-primary))]"
                  />
                ) : null}
              </Link>
            );
          })}
        </nav>

        <div className="mt-8">
          {tab === "packages" ? (
            <PackagesTab
              packages={packagesList.map((p) => ({
                id: p.id,
                name: p.name,
                description: p.description,
                durationMin: p.durationMin,
                sessionCount: p.sessionCount,
                priceCents: p.priceCents,
                currency: p.currency,
                depositPct: p.depositPct,
                active: p.active,
                kind: p.kind,
                locationType: p.locationType,
                bufferMinutes: p.bufferMinutes,
                minLeadHours: p.minLeadHours,
                paymentPlans: p.paymentPlans,
              }))}
            />
          ) : null}

          {tab === "availability" ? (
            <div className="space-y-4">
              <DurationPicker initialDefaultMin={availabilitySettings.defaultSessionMin} />
              <PoliciesEditor
                initialAutoConfirm={availabilitySettings.autoConfirmBookings}
                initialCancellationHours={availabilitySettings.cancellationPolicyHours}
              />
              {availabilityBlocks.length === 0 ? (
                <div className="rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-sunken))] px-5 py-4">
                  <p className="text-sm text-[rgb(var(--fg-primary))]">
                    No weekly hours set — clients see no bookable slots.
                  </p>
                  <p className="mt-1 text-xs text-[rgb(var(--fg-muted))]">
                    Tick a day below and drop in e.g. Monday 10am–6pm to get started.
                  </p>
                </div>
              ) : null}
              <AvailabilityEditor
                initialBlocks={availabilityBlocks.map((b) => ({
                  weekday: b.weekday,
                  startMin: b.startMin,
                  endMin: b.endMin,
                }))}
              />
              <BlackoutsEditor
                initialBlackouts={blackouts.map((b) => ({
                  id: b.id,
                  startDate: b.startDate,
                  endDate: b.endDate,
                  reason: b.reason,
                }))}
              />
            </div>
          ) : null}

          {tab === "requests" ? (
            <RequestsTab
              items={pendingBookings.map((b) => ({
                id: b.id,
                artistName: b.artistName,
                artistEmail: b.artistEmail,
                ...(b.artistPhone ? { artistPhone: b.artistPhone } : {}),
                ...(b.notes ? { notes: b.notes } : {}),
                startsAt: b.startsAt,
                durationMin: b.durationMin,
                ...(b.packageNameSnapshot ? { packageName: b.packageNameSnapshot } : {}),
              }))}
            />
          ) : null}

          {tab === "upcoming" ? (
            <UpcomingTab
              items={confirmedBookings.map((b) => ({
                id: b.id,
                artistName: b.artistName,
                artistEmail: b.artistEmail,
                startsAt: b.startsAt,
                durationMin: b.durationMin,
                ...(b.packageNameSnapshot ? { packageName: b.packageNameSnapshot } : {}),
              }))}
            />
          ) : null}
        </div>
      </div>
    </AppShell>
  );
}

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

type PackageRow = {
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
};

// DB returns loose `string` for a few enum-backed columns (the Product
// type was widened before the Phase-H.3 migration narrowed the schema).
// Narrow here so the InitialPackageValues passed to the client stays
// tight. Unknown values fall back to the same defaults NewPackageForm
// uses for create — safe because the form will immediately overwrite
// them on submit if the producer touched the field.
const VALID_CURRENCIES = ["USD", "EUR", "GBP", "ILS"] as const;
const VALID_KINDS = ["session", "mixing", "mastering", "producing", "other"] as const;
const VALID_LOCATIONS = ["studio", "remote", "client_space"] as const;
type InitCurrency = InitialPackageValues["currency"];
type InitKind = InitialPackageValues["kind"];
type InitLocation = InitialPackageValues["locationType"];
function toInitialValues(p: PackageRow): InitialPackageValues {
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
  };
}

function PackagesTab({ packages }: { packages: PackageRow[] }) {
  return (
    <div className="space-y-6">
      <div>
        <PackageToolbar />
      </div>
      {packages.length === 0 ? (
        <EmptyState
          icon={<CalendarIcon />}
          title="Your bookable services live here."
          description="A package is one offering — a mixing session, a mastering run, a production day. Visitors pick a package first, then a time slot."
          className="min-h-[60vh] justify-center"
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
                    <span className="inline-flex items-center rounded-full bg-[rgb(var(--fg-muted)/0.15)] px-2 py-0.5 text-[0.66rem] font-medium uppercase tracking-wider text-[rgb(var(--fg-secondary))]">
                      {KIND_LABEL[p.kind] ?? p.kind}
                    </span>
                    <span className="inline-flex items-center rounded-full bg-[rgb(var(--brand-primary)/0.12)] px-2 py-0.5 text-[0.66rem] font-medium uppercase tracking-wider text-[rgb(var(--brand-primary))]">
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

function RequestsTab({
  items,
}: {
  items: {
    id: string;
    artistName: string;
    artistEmail: string;
    artistPhone?: string;
    notes?: string;
    startsAt: Date;
    durationMin: number;
    packageName?: string;
  }[];
}) {
  if (items.length === 0) {
    return (
      <EmptyState
        icon={<InboxIcon />}
        title="No pending requests."
        description="When a visitor books, the request lands here for your approval. You can confirm or reject in one tap."
        className="min-h-[60vh] justify-center"
      />
    );
  }
  return (
    <ul className="overflow-hidden rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))]">
      {items.map((b, idx) => (
        <li
          key={b.id}
          className={[
            "px-4 py-3 transition-colors duration-[140ms] ease-out hover:bg-[rgb(var(--bg-overlay))]",
            idx === 0 ? "" : "border-t border-[rgb(var(--border-subtle))]",
          ].join(" ")}
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h3 className="font-display text-base leading-tight" style={{ fontWeight: 700 }}>
                  {b.artistName}
                </h3>
                <Badge variant="warning" dot>
                  Pending
                </Badge>
              </div>
              <p className="mt-0.5 font-mono text-xs text-[rgb(var(--fg-secondary))]">
                {b.artistEmail}
                {b.artistPhone ? ` · ${b.artistPhone}` : ""}
              </p>
              <p className="mt-1 text-[13px] text-[rgb(var(--fg-primary))]">
                {b.packageName ?? "Session"} ·{" "}
                <span className="sk-num">{b.durationMin}min</span> ·{" "}
                <span className="sk-num">{dateFmt.format(b.startsAt)}</span>
              </p>
              {b.notes ? (
                <p className="mt-2 rounded-[var(--radius-sm)] bg-[rgb(var(--bg-base))] p-3 text-sm text-[rgb(var(--fg-secondary))]">
                  &ldquo;{b.notes}&rdquo;
                </p>
              ) : null}
            </div>
            <BookingActionButtons id={b.id} artistName={b.artistName} />
          </div>
        </li>
      ))}
    </ul>
  );
}

function UpcomingTab({
  items,
}: {
  items: {
    id: string;
    artistName: string;
    artistEmail: string;
    startsAt: Date;
    durationMin: number;
    packageName?: string;
  }[];
}) {
  const future = items.filter((b) => b.startsAt.getTime() > Date.now());
  if (future.length === 0) {
    return (
      <EmptyState
        icon={<CalendarIcon />}
        title="No confirmed sessions."
        description="Sessions you approve from the Requests tab land here in chronological order, earliest first."
        className="min-h-[60vh] justify-center"
      />
    );
  }
  return (
    <ol className="overflow-hidden rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))]">
      {future.map((b, idx) => (
        <li
          key={b.id}
          className={[
            "px-4 py-3 transition-colors duration-[140ms] ease-out hover:bg-[rgb(var(--bg-overlay))]",
            idx === 0 ? "" : "border-t border-[rgb(var(--border-subtle))]",
          ].join(" ")}
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="font-display text-base leading-tight" style={{ fontWeight: 700 }}>
                {b.artistName}
              </p>
              <p className="mt-0.5 font-mono text-xs text-[rgb(var(--fg-secondary))]">
                {b.artistEmail}
              </p>
              <p className="mt-1 text-[13px] text-[rgb(var(--fg-primary))]">
                {b.packageName ?? "Session"} ·{" "}
                <span className="sk-num">{b.durationMin}min</span> ·{" "}
                <span className="sk-num">{dateFmt.format(b.startsAt)}</span>
              </p>
            </div>
            <Badge variant="active" dot>
              Confirmed
            </Badge>
          </div>
        </li>
      ))}
    </ol>
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

function InboxIcon() {
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
      <path d="M2 9.5h3.5l1 2h3l1-2H14" />
      <path d="M2 9.5 3.5 3h9L14 9.5v3.25A.75.75 0 0 1 13.25 13.5h-10.5A.75.75 0 0 1 2 12.75Z" />
    </svg>
  );
}
