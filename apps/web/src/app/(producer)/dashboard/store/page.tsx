// page.tsx
//
// Producer Store catalog. Server component that fetches the product
// list + producer profile and hands them to <StoreScreen>. Mirrors the
// shape used by the legacy /dashboard/profile?tab=store page so the
// data layer stays untouched.

import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

import type { Currency } from "~/app/(producer)/dashboard/booking/package-form";
import { appRouter } from "~/server/trpc/routers/_app";

import { StoreScreen, type StoreProduct } from "./store-screen";

export default async function StorePage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const caller = appRouter.createCaller({ userId });
  const [packages, profile] = await Promise.all([
    caller.booking.packages.list(),
    caller.producer.me(),
  ]);

  const products: StoreProduct[] = packages.map((p) => ({
    id: p.id,
    name: p.name,
    description: p.description,
    priceCents: p.priceCents,
    currency: p.currency,
    active: p.active,
    kind: p.kind,
    depositPct: p.depositPct,
    durationMin: p.durationMin,
    sessionCount: p.sessionCount,
    paymentPlans: p.paymentPlans,
    locationType: p.locationType,
    bufferMinutes: p.bufferMinutes,
    minLeadHours: p.minLeadHours,
    contractUrl: p.contractUrl,
    deliverables: p.deliverables ?? [],
  }));

  const VALID = ["USD", "EUR", "GBP", "ILS"] as const;
  const defaultCurrency: Currency = (VALID as readonly string[]).includes(
    profile.defaultCurrency,
  )
    ? (profile.defaultCurrency as Currency)
    : "USD";

  return <StoreScreen products={products} defaultCurrency={defaultCurrency} />;
}
