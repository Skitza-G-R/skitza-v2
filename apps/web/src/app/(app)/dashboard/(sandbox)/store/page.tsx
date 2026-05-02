import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

import { appRouter } from "~/server/trpc/routers/_app";

import { splitPublicLink } from "../../_design-test/data-mapping";
import {
  StorefrontTab,
  type StoreProduct,
} from "../../_design-test/storefront-tab";

// Storefront tab. Shell lives in (sandbox)/layout.tsx; this page
// fetches its own products + producer-shape data needed for the
// public-link UI bits inside the tab body.

export default async function StorePage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const caller = appRouter.createCaller({ userId });
  const [me, packageList] = await Promise.all([
    caller.producer.me(),
    caller.booking.products.list(),
  ]);

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
  );
}
