import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { appRouter } from "~/server/trpc/routers/_app";
import { IssueForm, RevokeButton, StatusPill } from "./lead-link-form";
import { deriveStatus } from "./status";

const dateFmt = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

function formatDate(d: Date | null): string {
  return d ? dateFmt.format(d) : "—";
}

// medianDwellMs is integer milliseconds from PG percentile_cont; format
// in seconds with one decimal so single-page-load dwells stay readable
// without exposing raw ms (which producers won't intuit).
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
  // Default fallback for the (theoretically impossible) case where list
  // returns an id that analytics doesn't — both queries scope to the
  // same producer, so this only fires under a race (link inserted
  // between the two SELECTs). Defensive but bounded.
  const rows = links.map((l) => ({
    ...l,
    ...(analyticsById.get(l.id) ?? {
      viewCount: 0,
      lastViewedAt: null as Date | null,
      medianDwellMs: null as number | null,
    }),
  }));

  return (
    <main className="p-8 max-w-5xl mx-auto">
      <div className="mb-6">
        <Link
          href="/dashboard"
          className="text-sm text-[rgb(var(--fg-secondary))] hover:text-[rgb(var(--fg-primary))]"
        >
          &larr; Dashboard
        </Link>
        <h1 className="text-2xl font-semibold mt-1">Lead Links</h1>
        <p className="mt-1 text-sm text-[rgb(var(--fg-secondary))]">
          Mint a magic URL that redirects visitors to your portfolio or booking page.
        </p>
      </div>

      <div className="mb-6">
        <IssueForm />
      </div>

      {rows.length === 0 ? (
        <p className="text-[rgb(var(--fg-secondary))]">
          No links yet. Issue your first one above.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))]">
          <table className="w-full text-sm">
            <thead className="bg-[rgb(var(--bg-elevated))] text-left text-xs uppercase tracking-wide text-[rgb(var(--fg-secondary))]">
              <tr>
                <th className="px-3 py-2 font-medium">Created</th>
                <th className="px-3 py-2 font-medium">Target</th>
                <th className="px-3 py-2 font-medium">Lead</th>
                <th className="px-3 py-2 font-medium">Opens</th>
                <th className="px-3 py-2 font-medium">Last Opened</th>
                <th className="px-3 py-2 font-medium">Dwell (median)</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const status = deriveStatus(row);
                return (
                  <tr
                    key={row.id}
                    className="border-t border-[rgb(var(--border-subtle))]"
                  >
                    <td className="px-3 py-2">{formatDate(row.createdAt)}</td>
                    <td className="px-3 py-2">{row.target}</td>
                    <td className="px-3 py-2 font-mono text-xs">
                      {row.leadId ? `${row.leadId.slice(0, 8)}…` : "—"}
                    </td>
                    <td className="px-3 py-2">{row.viewCount}</td>
                    <td className="px-3 py-2">{formatDate(row.lastViewedAt)}</td>
                    <td className="px-3 py-2">{formatDwell(row.medianDwellMs)}</td>
                    <td className="px-3 py-2"><StatusPill status={status} /></td>
                    <td className="px-3 py-2 text-right">
                      <RevokeButton id={row.id} disabled={status !== "active"} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
