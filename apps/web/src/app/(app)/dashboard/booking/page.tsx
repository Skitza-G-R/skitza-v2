import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";

import { AppShell } from "~/components/shell/app-shell";
import { Badge } from "~/components/ui/badge";
import { EmptyState } from "~/components/ui/empty-state";
import { appRouter } from "~/server/trpc/routers/_app";
import { AvailabilityEditor } from "./availability-editor";
import { BookingActionButtons } from "./booking-controls";
import { DeactivatePackageButton, CURRENCY_SYMBOL } from "./package-form";
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
  const [packagesList, availabilityBlocks, pendingBookings, confirmedBookings] =
    await Promise.all([
      caller.booking.packages.list(),
      caller.booking.availability.list(),
      caller.booking.list({ status: "pending" }),
      caller.booking.list({ status: "confirmed" }),
    ]);

  return (
    <AppShell active="booking">
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
          className="mt-8 flex gap-1 overflow-x-auto border-b border-[rgb(var(--border-subtle))] pb-px"
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
                  "flex items-center gap-2 whitespace-nowrap px-4 py-2 text-sm transition-colors",
                  "border-b-2",
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
              }))}
            />
          ) : null}

          {tab === "availability" ? (
            <AvailabilityEditor initialBlocks={availabilityBlocks.map((b) => ({ weekday: b.weekday, startMin: b.startMin, endMin: b.endMin }))} />
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

function PackagesTab({
  packages,
}: {
  packages: {
    id: string;
    name: string;
    description: string | null;
    durationMin: number;
    sessionCount: number;
    priceCents: number;
    currency: string;
    depositPct: number;
    active: boolean;
  }[];
}) {
  return (
    <div className="space-y-6">
      <div>
        <PackageToolbar />
      </div>
      {packages.length === 0 ? (
        <EmptyState
          title="No packages yet."
          description="Add your first offering — e.g. Full Production ($1,500 · 4 sessions · 25% deposit). Visitors pick a package before booking a slot."
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
                  <h3 className="font-display text-xl tracking-tight" style={{ fontWeight: 700 }}>
                    {p.name}
                  </h3>
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
              {p.active ? (
                <div className="mt-4 flex justify-end">
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
        title="No pending requests."
        description="When a visitor books a slot on your public page, the request shows up here for you to approve or reject."
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
        title="No confirmed sessions."
        description="Sessions you approve from the Requests tab land here in chronological order."
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
