import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { appRouter } from "~/server/trpc/routers/_app";
import { AppShell } from "~/components/shell/app-shell";
import { Badge } from "~/components/ui/badge";
import { EmptyState } from "~/components/ui/empty-state";
import { IssueForm, RevokeButton, StatusPill } from "./lead-link-form";
import { deriveStatus } from "./status";

// Date formatter instantiated once at module scope — not per-render. Relative
// formatter is used for the "last opened" column where absolute timestamps
// add cognitive load.
const dateFmt = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});
const relFmt = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

function formatDate(d: Date | null): string {
  return d ? dateFmt.format(d) : "—";
}

// Relative time for "last opened" — reads fast ("2h ago") vs. a full stamp.
function formatRelative(d: Date | null): string {
  if (!d) return "—";
  const diffMs = d.getTime() - Date.now();
  const abs = Math.abs(diffMs);
  const min = 60_000;
  const hr = 3_600_000;
  const day = 86_400_000;
  if (abs < min) return "just now";
  if (abs < hr) return relFmt.format(Math.round(diffMs / min), "minute");
  if (abs < day) return relFmt.format(Math.round(diffMs / hr), "hour");
  return relFmt.format(Math.round(diffMs / day), "day");
}

// medianDwellMs is integer milliseconds from PG percentile_cont; format
// in seconds with one decimal so single-page-load dwells stay readable.
function formatDwell(ms: number | null): string {
  if (ms === null) return "—";
  return `${(ms / 1000).toFixed(1)}s`;
}

export default async function LeadsPage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const caller = appRouter.createCaller({ userId });
  // Parallel: list (per-link metadata) + analytics (aggregates). Both
  // procedures are scoped to the same producerProcedure, so the cost is
  // ~one DB round-trip each, fired concurrently.
  const [links, analytics] = await Promise.all([
    caller.magicLink.list(),
    caller.magicLink.analytics(),
  ]);

  const analyticsById = new Map(analytics.map((a) => [a.id, a]));
  const rows = links.map((l) => ({
    ...l,
    ...(analyticsById.get(l.id) ?? {
      viewCount: 0,
      lastViewedAt: null as Date | null,
      medianDwellMs: null as number | null,
    }),
  }));

  return (
    <AppShell active="leads">
      <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-14">
        <header className="reveal-up flex flex-wrap items-end justify-between gap-6">
          <div>
            <p className="font-mono text-[0.72rem] uppercase tracking-[0.18em] text-[rgb(var(--fg-muted))]">
              Lead Links
            </p>
            <h1
              className="mt-2 font-display text-4xl leading-tight tracking-tight sm:text-5xl"
              style={{ fontVariationSettings: '"opsz" 96' }}
            >
              The link you send leads.
            </h1>
            <p className="mt-3 max-w-xl text-sm text-[rgb(var(--fg-secondary))]">
              Mint a single magic URL that routes a visitor to your portfolio or booking
              page — with opens, last-opened, and dwell analytics flowing back.
            </p>
          </div>
        </header>

        <section className="mt-8 reveal-up-delay-1">
          <IssueForm />
        </section>

        <section className="mt-10">
          {rows.length === 0 ? (
            <EmptyState
              icon={<LinkIcon />}
              title="No links yet."
              description="Magic lead links let visitors browse your portfolio or book without signing up. Generate one to start tracking opens + dwell time."
              className="min-h-[60vh] justify-center"
            />
          ) : (
            <>
              {/* Desktop table — dense Linear-grade rows via shared utility
                  tokens (.sk-row density is mirrored on table rows by
                  keeping cells ~44px tall with py-0 + h-11). */}
              <div className="hidden overflow-hidden rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] md:block">
                <table className="w-full text-[13px] leading-[1.3]">
                  <thead className="bg-[rgb(var(--bg-elevated))] text-left font-mono text-[0.66rem] uppercase tracking-[0.14em] text-[rgb(var(--fg-muted))]">
                    <tr>
                      <th className="px-3 py-2 font-medium">Created</th>
                      <th className="px-3 py-2 font-medium">Target</th>
                      <th className="px-3 py-2 font-medium">Lead</th>
                      <th className="px-3 py-2 font-medium sk-num">Opens</th>
                      <th className="px-3 py-2 font-medium">Last</th>
                      <th className="px-3 py-2 font-medium sk-num">Dwell</th>
                      <th className="px-3 py-2 font-medium">Status</th>
                      <th className="px-3 py-2 text-right font-medium">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => {
                      const status = deriveStatus(row);
                      return (
                        <tr
                          key={row.id}
                          className="h-11 border-t border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-base))] transition-colors duration-[140ms] ease-out hover:bg-[rgb(var(--bg-overlay))]"
                        >
                          <td className="px-3 py-0 text-[rgb(var(--fg-secondary))]">
                            <Link
                              href={`/dashboard/leads/${row.id}`}
                              className="hover:text-[rgb(var(--fg-primary))] hover:underline underline-offset-4"
                            >
                              {formatDate(row.createdAt)}
                            </Link>
                          </td>
                          <td className="px-3 py-0 capitalize">{row.target}</td>
                          <td className="px-3 py-0 font-mono text-xs text-[rgb(var(--fg-muted))]">
                            {row.leadId ? `${row.leadId.slice(0, 8)}…` : "—"}
                          </td>
                          <td className="px-3 py-0 sk-num">{row.viewCount}</td>
                          <td className="px-3 py-0 text-[rgb(var(--fg-secondary))]">
                            {formatRelative(row.lastViewedAt)}
                          </td>
                          <td className="px-3 py-0 sk-num text-[rgb(var(--fg-secondary))]">
                            {formatDwell(row.medianDwellMs)}
                          </td>
                          <td className="px-3 py-0">
                            <StatusPill status={status} />
                          </td>
                          <td className="px-3 py-0 text-right">
                            <RevokeButton id={row.id} disabled={status !== "active"} />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Mobile cards */}
              <ul className="grid gap-3 md:hidden">
                {rows.map((row) => {
                  const status = deriveStatus(row);
                  return (
                    <li
                      key={row.id}
                      className="rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-4"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <Link href={`/dashboard/leads/${row.id}`} className="flex-1">
                          <p className="text-xs text-[rgb(var(--fg-muted))]">
                            {formatDate(row.createdAt)}
                          </p>
                          <p className="mt-1 font-display text-lg capitalize leading-none">
                            {row.target}
                          </p>
                        </Link>
                        <StatusPill status={status} />
                      </div>
                      <dl className="mt-4 grid grid-cols-3 gap-3 text-center">
                        <Stat label="Opens" value={String(row.viewCount)} />
                        <Stat label="Last" value={formatRelative(row.lastViewedAt)} />
                        <Stat label="Dwell" value={formatDwell(row.medianDwellMs)} />
                      </dl>
                      <div className="mt-4 flex items-center justify-between">
                        <span className="font-mono text-[0.7rem] text-[rgb(var(--fg-muted))]">
                          {row.leadId ? `Lead · ${row.leadId.slice(0, 8)}…` : "No lead attached"}
                        </span>
                        <RevokeButton id={row.id} disabled={status !== "active"} />
                      </div>
                    </li>
                  );
                })}
              </ul>

              <p className="mt-4 flex items-center gap-2 font-mono text-xs text-[rgb(var(--fg-muted))]">
                <Badge variant="neutral" dot>
                  {rows.length} link{rows.length === 1 ? "" : "s"}
                </Badge>
                · Raw URLs are never stored. Revoked links 404 instantly.
              </p>
            </>
          )}
        </section>
      </div>
    </AppShell>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[var(--radius-md)] bg-[rgb(var(--bg-base))] px-2 py-2">
      <dt className="font-mono text-[0.6rem] uppercase tracking-wider text-[rgb(var(--fg-muted))]">
        {label}
      </dt>
      <dd className="sk-num mt-1 font-display text-base leading-tight">{value}</dd>
    </div>
  );
}

function LinkIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1.5 1.5" />
      <path d="M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1.5-1.5" />
    </svg>
  );
}
