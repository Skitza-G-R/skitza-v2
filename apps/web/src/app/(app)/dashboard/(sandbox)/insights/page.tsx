import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

import { appRouter } from "~/server/trpc/routers/_app";

import {
  InsightsTab,
  type InsightsBooking,
  type InsightsProduct,
  type InsightsStats,
} from "../../_design-test/insights-tab";

// Insights tab. Shell lives in (sandbox)/layout.tsx; this page only
// fetches its own analytics-shaped data and returns the inner tab.

export default async function InsightsPage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const caller = appRouter.createCaller({ userId });
  const [today, allBookings, packageList] = await Promise.all([
    caller.producer.today(),
    caller.booking.list(),
    caller.booking.products.list(),
  ]);

  const bookings: InsightsBooking[] = allBookings.map((b) => {
    let status: InsightsBooking["status"];
    if (b.status === "pending") status = "inquiry";
    else if (b.status === "confirmed") {
      const ends = new Date(b.startsAt.getTime() + b.durationMin * 60_000);
      status = ends < new Date() ? "completed" : "booked";
    } else status = "completed";
    return { id: b.id, status };
  });

  const products: InsightsProduct[] = packageList.map((pkg) => ({
    id: pkg.id,
    name: pkg.name,
    type: pkg.kind,
    price: Math.round(pkg.priceCents / 100),
    bookingsThisMonth: 0,
  }));

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

  return <InsightsTab data={{ stats, bookings, products }} />;
}
