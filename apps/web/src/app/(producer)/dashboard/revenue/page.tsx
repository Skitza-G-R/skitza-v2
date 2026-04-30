import { auth } from "@clerk/nextjs/server";
import Link from "next/link";
import { redirect } from "next/navigation";

import { RevenueTrend } from "~/components/dashboard/revenue/revenue-trend";
import { appRouter } from "~/server/trpc/routers/_app";

// Story 07 — `/dashboard/revenue` deep-chart route.
//
// Pulse card on Today (Story 02) navigates the producer here. The
// route's job: give the 6-month line chart enough vertical room to
// breathe — it was previously rendered as a stretched 16:5 horizon
// inline on the dashboard, which compresses the y-axis and loses the
// month-over-month shape. On a dedicated page we can center it in an
// 800px column with proper page chrome (eyebrow + H1 + back-link)
// instead.
//
// File location: `~/components/dashboard/revenue/revenue-trend`.
// The component originally lived under `dashboard/today/`, but Story
// 06 retired the inline chart from Today and relocated the source
// here so the import path matches the route that actually owns it.
//
// No new tRPC procedures — reuses `producer.revenueTrend()`
// unchanged. The empty-state overlay is the only piece of behaviour
// not already in the chart component itself: the chart renders the
// faint y-axis grid guides + a flat baseline when every bucket is
// zero, and we layer a centered explanatory message on top of it so
// a producer with no paid invoices yet sees both the empty graph
// shape AND a sentence telling them what would fill it.
export default async function RevenuePage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const caller = appRouter.createCaller({ userId });
  const { points, currency } = await caller.producer.revenueTrend();

  // Empty-state predicate — every monthly bucket reports zero cents.
  // We still render the chart (it draws the grid + flat baseline,
  // which doubles as the empty-state visual), and overlay a message
  // explaining what makes the chart fill up. Keeps the page composed
  // even on day 1 instead of swapping in a different layout.
  const isEmpty = points.every((p) => p.cents === 0);

  return (
    <div className="mx-auto max-w-[1280px] px-4 pt-8 pb-10 sm:px-8 lg:px-12 lg:pt-12">
      <Link
        href="/dashboard"
        className="font-mono text-[0.66rem] uppercase tracking-[0.2em] text-[rgb(var(--fg-muted))] hover:text-[rgb(var(--brand-primary))]"
      >
        ← Back to Today
      </Link>
      <header className="mt-6 mb-10">
        <p className="font-mono text-[0.66rem] uppercase tracking-[0.2em] text-[rgb(var(--fg-muted))]">
          Revenue
        </p>
        <h1 className="mt-2 font-display text-3xl tracking-tight text-[rgb(var(--fg-primary))] sm:text-4xl">
          Last 6 months of paid invoices
        </h1>
      </header>
      <div className="relative mx-auto max-w-[800px]">
        <RevenueTrend points={points} currency={currency} />
        {isEmpty ? (
          <div
            // Centered absolute overlay so the message floats on top
            // of the chart's empty grid. pointer-events-none keeps
            // the chart's hover strips reachable underneath, even
            // though there's nothing to hover when every point is
            // zero. Padding gives the copy room to breathe inside
            // the elevated surface.
            role="status"
            className="pointer-events-none absolute inset-0 flex items-center justify-center"
          >
            <p className="max-w-[18rem] rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-4 py-3 text-center text-sm text-[rgb(var(--fg-secondary))] shadow-[var(--shadow-sm)]">
              No paid invoices yet. Your chart fills up when invoices get paid.
            </p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
