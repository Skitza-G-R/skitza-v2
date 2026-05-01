import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

import { appRouter } from "~/server/trpc/routers/_app";

import { initialsOf } from "../_design-test/data-mapping";
import { DesignShell } from "../_design-test/design-shell";
import {
  InsightsTab,
  type InsightsBooking,
  type InsightsProduct,
  type InsightsStats,
} from "../_design-test/insights-tab";
import type { Producer } from "../_design-test/shell";

// gili/design-test branch — Insights tab. Wires the mockup's KPI
// tiles + funnel + booking pipeline against real data where it
// exists; placeholder for fields that need analytics infra Skitza
// doesn't have yet (page views, conversion %, traffic sources).

export default async function InsightsPage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const caller = appRouter.createCaller({ userId });
  const [me, today, allBookings, packageList] = await Promise.all([
    caller.producer.me(),
    caller.producer.today(),
    caller.booking.list(),
    caller.booking.products.list(),
  ]);

  const producer: Producer = {
    name: me.displayName ?? "Your Studio",
    initials: initialsOf(me.displayName),
    plan: "Pro",
    avatarGrad: "grad-amber",
  };

  // Map status enum from the booking router (pending/confirmed/
  // rejected/cancelled) to the mockup's Insights pipeline stages
  // (inquiry/hold/booked/completed). Best-effort mapping — Skitza
  // doesn't track "hold" or "completed" separately.
  const bookings: InsightsBooking[] = allBookings.map((b) => {
    let status: InsightsBooking["status"];
    if (b.status === "pending") status = "inquiry";
    else if (b.status === "confirmed") {
      // After end time, count as completed; otherwise booked.
      const ends = new Date(
        b.startsAt.getTime() + b.durationMin * 60_000,
      );
      status = ends < new Date() ? "completed" : "booked";
    } else status = "completed";
    return { id: b.id, status };
  });

  const products: InsightsProduct[] = packageList.map((pkg) => ({
    id: pkg.id,
    name: pkg.name,
    type: pkg.kind,
    price: Math.round(pkg.priceCents / 100),
    bookingsThisMonth: 0, // analytics not tracked yet
  }));

  // Real revenue this month from pulseStats; views/conversion are
  // placeholder until the public-page analytics infra lands.
  const revenueThisMonth = Math.round(today.pulseStats.thisMonthCents / 100);
  const stats: InsightsStats = {
    views7d: 0,
    views7dDelta: 0,
    bookings7d: bookings.filter((b) => b.status !== "completed").length,
    bookings7dDelta: 0,
    revenue7d: revenueThisMonth,
    revenue7dDelta: today.pulseStats.deltaPct ?? 0,
    conversion: 0,
    conversionDelta: 0,
    topProduct: products[0]?.name ?? "—",
    topSource: "—",
    daily: Array.from({ length: 14 }, () => 0),
    sources: [
      { label: "Direct", pct: 0, count: 0 },
      { label: "Instagram", pct: 0, count: 0 },
      { label: "WhatsApp", pct: 0, count: 0 },
      { label: "Spotify", pct: 0, count: 0 },
    ],
  };

  return (
    <DesignShell producer={producer}>
      <InsightsTab data={{ stats, bookings, products }} />
    </DesignShell>
  );
}
