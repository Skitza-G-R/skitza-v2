import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

import { appRouter } from "~/server/trpc/routers/_app";

import { initialsOf, splitPublicLink } from "../_design-test/data-mapping";
import { DesignShell } from "../_design-test/design-shell";
import {
  StorefrontTab,
  type StoreProduct,
} from "../_design-test/storefront-tab";
import type { Producer } from "../_design-test/shell";

// gili/design-test branch — Storefront tab. New route at /dashboard/
// store. Wires the mockup's product cards against real
// booking.list() rows (Skitza service packages).

export default async function StorePage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const caller = appRouter.createCaller({ userId });
  const [me, packageList] = await Promise.all([
    caller.producer.me(),
    caller.booking.products.list(),
  ]);

  const producer: Producer = {
    name: me.displayName ?? "Your Studio",
    initials: initialsOf(me.displayName),
    plan: "Pro",
    avatarGrad: "grad-amber",
  };

  const slug = me.slug;
  const publicBaseUrl =
    process.env.NEXT_PUBLIC_SITE_URL ?? "https://skitza.app";
  const fullPublicLink = `${publicBaseUrl.replace(/\/$/, "")}/join/${slug}`;
  const { prefix: publicLinkPrefix, slug: publicLinkSlug } =
    splitPublicLink(fullPublicLink);

  const products: StoreProduct[] = packageList.map((pkg) => ({
    id: pkg.id,
    name: pkg.name,
    type: pkg.kind,
    price: Math.round(pkg.priceCents / 100),
    currency: pkg.currency,
    duration: `${String(pkg.durationMin)} min`,
    sessions: 1,
    visible: pkg.active,
    featured: false,
  }));

  const brand = me.brand as Record<string, unknown>;
  const tagline = typeof brand.tagline === "string" ? brand.tagline : "";

  return (
    <DesignShell producer={producer}>
      <StorefrontTab
        data={{
          producer: {
            name: me.displayName ?? "Your Studio",
            tagline,
            publicLinkSlug,
            publicLinkPrefix,
          },
          products,
          stats: {
            views7d: 0,
            views7dDelta: 0,
            bookings7d: 0,
            bookings7dDelta: 0,
            conversion: 0,
          },
        }}
      />
    </DesignShell>
  );
}
