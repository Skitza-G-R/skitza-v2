import { auth } from "@clerk/nextjs/server";
import { TRPCError } from "@trpc/server";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { PurchaseRequestScreen } from "~/components/artist/purchase/purchase-request-screen";
import { snapshotProductPrice } from "~/lib/purchase/price-snapshot";
import { appRouter } from "~/server/trpc/routers/_app";

type PageProps = {
  params: Promise<{ productId: string }>;
  searchParams: Promise<{ songs?: string }>;
};

export const metadata: Metadata = { title: "Request to book" };

export default async function ArtistPurchaseRequestPage({ params, searchParams }: PageProps) {
  const { userId } = await auth();
  if (!userId) notFound();
  const { productId } = await params;
  const { songs } = await searchParams;
  const caller = appRouter.createCaller({ userId });

  try {
    const row = await caller.artist.store.product({ productId });
    const active = await caller.artist.purchase.activeForStudio({ producerId: row.producerId });
    if (active.blocked) redirect(active.href);

    const requestedSongQty =
      row.pricingModel === "per_song" && Number.isInteger(Number(songs)) && Number(songs) > 0
        ? Math.min(1_000, Number(songs))
        : undefined;
    const price = snapshotProductPrice(
      {
        pricingModel: row.pricingModel,
        priceCents: row.priceCents,
        hourlyRateCents: null,
        volumeTiers: row.volumeTiers,
      },
      requestedSongQty === undefined ? {} : { songQty: requestedSongQty },
    );

    return (
      <PurchaseRequestScreen
        productId={row.id}
        productName={row.name}
        producerName={row.producerName}
        studioId={row.producerId}
        amountCents={price.priceCents}
        currency={row.currency}
        songQty={requestedSongQty}
        targetProjects={row.targetProjects.map((project) => ({
          id: project.id,
          title: project.title,
          lifecycleStatus: project.lifecycleStatus,
          workflowStage: project.workflowStage,
          updatedAtIso: project.updatedAt.toISOString(),
        }))}
      />
    );
  } catch (error) {
    if (error instanceof TRPCError) {
      if (error.code === "BAD_REQUEST") redirect("/artist/store?notice=unavailable");
      if (error.code === "NOT_FOUND") notFound();
    }
    throw error;
  }
}
