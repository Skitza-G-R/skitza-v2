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
import { GCalSyncBadge } from "./gcal-sync-badge";
import { PoliciesEditor } from "./policies-editor";
import {
  CURRENCY_SYMBOL,
  DeactivatePackageButton,
  type InitialPackageValues,
} from "./package-form";
import { PackageToolbar } from "./package-toolbar";

// Batch B restructure — primary tabs shrink to the three that match the
// StudioFlow pattern: Sessions (availability editor) / Weekly (visual
// grid) / Upcoming (confirmed + pending).
//
// Legacy URL compat: `tab=availability` now renders Sessions (same
// content) and `tab=requests` redirects to Upcoming (pending approvals
// surface there as a banner). `tab=packages` remains reachable for the
// Setup → Services cross-link but isn't in the primary tab bar.
type Tab = "sessions" | "weekly" | "upcoming" | "packages";

// Tab state lives in URL search params so producers can share links
// to e.g. /dashboard/booking?tab=sessions directly.
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
  // Legacy aliases folded into the new 3-tab layout.
  if (raw === "availability") return "sessions";
  if (raw === "requests") return "upcoming";
  if (
    raw === "sessions" ||
    raw === "weekly" ||
    raw === "upcoming" ||
    raw === "packages"
  ) {
    return raw;
  }
  return "sessions";
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

        {/* Tab nav — 3 primary tabs (Sessions / Weekly / Upcoming).
            Packages is reachable via ?tab=packages (Setup → Services
            cross-link) but not in the bar. */}
        <nav
          aria-label="Booking sections"
          className="sk-scroll-x mt-8 flex gap-1 overflow-x-auto border-b border-[rgb(var(--border-subtle))] pb-px"
        >
          {(
            [
              { key: "sessions", label: "Sessions", count: availabilityBlocks.length, dot: false },
              { key: "weekly", label: "Weekly schedule", count: 0, dot: false },
              {
                key: "upcoming",
                label: "Upcoming sessions",
                count: confirmedBookings.length,
                // Dot on upcoming when there are pending requests —
                // they're surfaced inside this tab's banner so the
                // producer notices them at a glance from the nav.
                dot: pendingBookings.length > 0,
              },
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
                  // desktop where the 3-tab rail stays dense. rounded-t-sm
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

          {tab === "sessions" ? (
            <div className="space-y-4">
              {/* GCal sync status — UI stub ahead of real OAuth integration.
                  Shown first because the screenshot puts it at the top of
                  the Sessions column. Hard-coded to `not_connected` until
                  the OAuth flow ships; the component accepts a `status`
                  prop so the wiring site is one-line when that lands. */}
              <GCalSyncBadge status="not_connected" />
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

          {tab === "weekly" ? (
            <WeeklyScheduleTab
              blocks={availabilityBlocks.map((b) => ({
                weekday: b.weekday,
                startMin: b.startMin,
                endMin: b.endMin,
              }))}
              confirmed={confirmedBookings.map((b) => ({
                id: b.id,
                startsAt: b.startsAt,
                durationMin: b.durationMin,
                artistName: b.artistName,
              }))}
            />
          ) : null}

          {tab === "upcoming" ? (
            <UpcomingTab
              pending={pendingBookings.map((b) => ({
                id: b.id,
                artistName: b.artistName,
                artistEmail: b.artistEmail,
                ...(b.artistPhone ? { artistPhone: b.artistPhone } : {}),
                ...(b.notes ? { notes: b.notes } : {}),
                startsAt: b.startsAt,
                durationMin: b.durationMin,
                ...(b.packageNameSnapshot ? { packageName: b.packageNameSnapshot } : {}),
              }))}
              confirmed={confirmedBookings.map((b) => ({
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

type PendingItem = {
  id: string;
  artistName: string;
  artistEmail: string;
  artistPhone?: string;
  notes?: string;
  startsAt: Date;
  durationMin: number;
  packageName?: string;
};

type ConfirmedItem = {
  id: string;
  artistName: string;
  artistEmail: string;
  startsAt: Date;
  durationMin: number;
  packageName?: string;
};

// Batch B — merged requests + upcoming. Pending approvals surface as
// a highlighted section at the top of the tab so producers approve
// them without bouncing between tabs. Confirmed sessions in the next
// 30 days land below in chronological order.
const NEXT_30_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

function UpcomingTab({
  pending,
  confirmed,
}: {
  pending: PendingItem[];
  confirmed: ConfirmedItem[];
}) {
  const now = Date.now();
  const horizon = now + NEXT_30_DAYS_MS;
  const futureConfirmed = confirmed.filter(
    (b) => b.startsAt.getTime() > now && b.startsAt.getTime() <= horizon,
  );

  const showingNothing = pending.length === 0 && futureConfirmed.length === 0;

  if (showingNothing) {
    return (
      <EmptyState
        icon={<CalendarIcon />}
        title="Nothing coming up."
        description="Approved sessions in the next 30 days will appear here, along with any pending requests that need a review."
        className="min-h-[60vh] justify-center"
      />
    );
  }

  return (
    <div className="space-y-6">
      {pending.length > 0 ? (
        <section>
          <div className="mb-2 flex items-center gap-2">
            <h2
              className="font-display text-sm tracking-tight text-[rgb(var(--fg-primary))]"
              style={{ fontWeight: 700 }}
            >
              Pending approval
            </h2>
            <span className="sk-num font-mono text-xs text-[rgb(var(--fg-muted))]">
              {pending.length}
            </span>
          </div>
          <ul className="overflow-hidden rounded-[var(--radius-lg)] border border-[rgb(var(--fg-warning)/0.45)] bg-[rgb(var(--bg-elevated))]">
            {pending.map((b, idx) => (
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
                      <h3
                        className="font-display text-base leading-tight"
                        style={{ fontWeight: 700 }}
                      >
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
        </section>
      ) : null}

      <section>
        <div className="mb-2 flex items-center gap-2">
          <h2
            className="font-display text-sm tracking-tight text-[rgb(var(--fg-primary))]"
            style={{ fontWeight: 700 }}
          >
            Next 30 days
          </h2>
          <span className="sk-num font-mono text-xs text-[rgb(var(--fg-muted))]">
            {futureConfirmed.length}
          </span>
        </div>
        {futureConfirmed.length === 0 ? (
          <div className="rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-sunken))] px-5 py-4 text-sm text-[rgb(var(--fg-secondary))]">
            No confirmed sessions scheduled in the next 30 days.
          </div>
        ) : (
          <ol className="overflow-hidden rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))]">
            {futureConfirmed.map((b, idx) => (
              <li
                key={b.id}
                className={[
                  "px-4 py-3 transition-colors duration-[140ms] ease-out hover:bg-[rgb(var(--bg-overlay))]",
                  idx === 0 ? "" : "border-t border-[rgb(var(--border-subtle))]",
                ].join(" ")}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p
                      className="font-display text-base leading-tight"
                      style={{ fontWeight: 700 }}
                    >
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
        )}
      </section>
    </div>
  );
}

// ─── Weekly schedule grid ───────────────────────────────────────────
//
// Visual read-only view of the week's availability windows. Columns =
// weekdays (Mon..Sun), rows = hours (0..24). Each window renders as a
// solid block; confirmed sessions in this week overlay as darker
// semitransparent ticks so the producer can spot a busy day at a glance.
//
// This is intentionally read-only — edits still happen on the Sessions
// tab, keeping the grid as a "view the week" surface rather than a
// drag-to-edit calendar (scope creep for Batch B).

const WEEKLY_GRID_WEEKDAYS = [
  { num: 1, label: "Mon" },
  { num: 2, label: "Tue" },
  { num: 3, label: "Wed" },
  { num: 4, label: "Thu" },
  { num: 5, label: "Fri" },
  { num: 6, label: "Sat" },
  { num: 0, label: "Sun" },
] as const;

// Render hours 6am → 11pm by default — most music-producer sessions
// fit inside this window. Windows outside this range still show with
// their actual position; the grid just doesn't extend to midnight.
const GRID_START_HOUR = 6;
const GRID_END_HOUR = 23;
const GRID_HOURS = GRID_END_HOUR - GRID_START_HOUR;

function WeeklyScheduleTab({
  blocks,
  confirmed,
}: {
  blocks: { weekday: number; startMin: number; endMin: number }[];
  confirmed: {
    id: string;
    startsAt: Date;
    durationMin: number;
    artistName: string;
  }[];
}) {
  // Group blocks by weekday for O(1) lookup during render.
  const blocksByDay = new Map<number, { startMin: number; endMin: number }[]>();
  for (const b of blocks) {
    const list = blocksByDay.get(b.weekday) ?? [];
    list.push({ startMin: b.startMin, endMin: b.endMin });
    blocksByDay.set(b.weekday, list);
  }

  // Compute the start of the current week (Mon 00:00 local) so we can
  // overlay this week's confirmed bookings on the grid. Anything
  // outside the current ISO week is hidden — the grid is weekly, not
  // a multi-week calendar.
  const now = new Date();
  const nowDay = now.getDay(); // 0=Sun..6=Sat
  const daysSinceMonday = nowDay === 0 ? 6 : nowDay - 1;
  const weekStart = new Date(now);
  weekStart.setHours(0, 0, 0, 0);
  weekStart.setDate(weekStart.getDate() - daysSinceMonday);
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 7);

  const sessionsByDay = new Map<
    number,
    { id: string; startMin: number; endMin: number; artistName: string }[]
  >();
  for (const s of confirmed) {
    const t = s.startsAt.getTime();
    if (t < weekStart.getTime() || t >= weekEnd.getTime()) continue;
    const d = s.startsAt.getDay();
    const startMin = s.startsAt.getHours() * 60 + s.startsAt.getMinutes();
    const list = sessionsByDay.get(d) ?? [];
    list.push({
      id: s.id,
      startMin,
      endMin: startMin + s.durationMin,
      artistName: s.artistName,
    });
    sessionsByDay.set(d, list);
  }

  if (blocks.length === 0) {
    return (
      <EmptyState
        icon={<CalendarIcon />}
        title="No windows yet."
        description="Set your weekly hours on the Sessions tab and they'll render here as a visual grid."
        className="min-h-[60vh] justify-center"
      />
    );
  }

  // Height per hour in pixels — fixed so layout math stays simple.
  const HOUR_PX = 36;
  const totalHeight = GRID_HOURS * HOUR_PX;

  return (
    <div className="rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3
            className="font-display text-sm tracking-tight text-[rgb(var(--fg-primary))]"
            style={{ fontWeight: 700 }}
          >
            This week at a glance
          </h3>
          <p className="mt-0.5 text-xs text-[rgb(var(--fg-secondary))]">
            Windows drawn from your Sessions tab; confirmed bookings overlay in
            solid ticks.
          </p>
        </div>
        <div className="flex items-center gap-3 text-xs text-[rgb(var(--fg-secondary))]">
          <span className="flex items-center gap-1.5">
            <span className="h-3 w-3 rounded-sm bg-[rgb(var(--brand-primary)/0.3)]" />
            Open window
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-3 w-3 rounded-sm bg-[rgb(var(--brand-primary))]" />
            Booked
          </span>
        </div>
      </div>

      <div className="flex">
        {/* Hour axis */}
        <div
          className="flex-shrink-0 pr-2"
          style={{ height: `${String(totalHeight)}px` }}
        >
          {Array.from({ length: GRID_HOURS + 1 }, (_, i) => {
            const h = GRID_START_HOUR + i;
            return (
              <div
                key={h}
                className="relative font-mono text-[0.65rem] text-[rgb(var(--fg-muted))]"
                style={{ height: `${String(HOUR_PX)}px`, marginTop: i === 0 ? 0 : undefined }}
              >
                <span className="absolute -top-1.5 right-0">
                  {String(h).padStart(2, "0")}:00
                </span>
              </div>
            );
          })}
        </div>

        {/* 7-day columns */}
        <div className="grid flex-1 grid-cols-7 gap-px overflow-hidden rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--border-subtle))]">
          {WEEKLY_GRID_WEEKDAYS.map(({ num, label }) => {
            const dayBlocks = blocksByDay.get(num) ?? [];
            const daySessions = sessionsByDay.get(num) ?? [];
            return (
              <div
                key={num}
                className="relative bg-[rgb(var(--bg-base))]"
                style={{ height: `${String(totalHeight)}px` }}
              >
                <div className="absolute inset-x-0 top-0 border-b border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-sunken))] px-1 py-1 text-center font-mono text-[0.65rem] text-[rgb(var(--fg-secondary))]">
                  {label}
                </div>
                {/* Availability windows */}
                {dayBlocks.map((b, idx) => {
                  const top = Math.max(
                    0,
                    ((b.startMin - GRID_START_HOUR * 60) / 60) * HOUR_PX,
                  );
                  const height = Math.max(
                    2,
                    ((Math.min(b.endMin, GRID_END_HOUR * 60) - b.startMin) / 60) *
                      HOUR_PX,
                  );
                  return (
                    <div
                      key={idx}
                      className="absolute inset-x-1 rounded-sm bg-[rgb(var(--brand-primary)/0.18)]"
                      style={{ top: `${String(top)}px`, height: `${String(height)}px` }}
                      aria-hidden
                    />
                  );
                })}
                {/* Confirmed sessions overlay */}
                {daySessions.map((s) => {
                  const top = Math.max(
                    0,
                    ((s.startMin - GRID_START_HOUR * 60) / 60) * HOUR_PX,
                  );
                  const height = Math.max(
                    2,
                    ((Math.min(s.endMin, GRID_END_HOUR * 60) - s.startMin) / 60) *
                      HOUR_PX,
                  );
                  return (
                    <div
                      key={s.id}
                      className="absolute inset-x-1 overflow-hidden rounded-sm bg-[rgb(var(--brand-primary))] px-1 py-0.5 font-mono text-[0.6rem] text-white"
                      style={{ top: `${String(top)}px`, height: `${String(height)}px` }}
                      title={s.artistName}
                    >
                      {height >= 18 ? s.artistName : ""}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
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

