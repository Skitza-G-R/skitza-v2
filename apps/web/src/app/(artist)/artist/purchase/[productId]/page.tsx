import { auth } from "@clerk/nextjs/server";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { TRPCError } from "@trpc/server";

import { ProductDetailScreen } from "~/components/artist/purchase/product-detail-screen";
import { toProducer, toPurchaseProduct } from "~/lib/purchase/product-mapping";
import { coerceTaxMode } from "~/lib/tax-mode";
import { appRouter } from "~/server/trpc/routers/_app";

type PageProps = { params: Promise<{ productId: string }> };

export const metadata: Metadata = { title: "Product details" };

// Unified signed-in Store detail. The artist chooses quantity (when relevant)
// and a same-client target here, then sends intent only. Commercial terms are
// frozen later at explicit acceptance.
export default async function PurchaseEntryPage({ params }: PageProps) {
  const { userId } = await auth();
  if (!userId) return null;

  const { productId } = await params;
  const caller = appRouter.createCaller({ userId });

  let row: Awaited<ReturnType<typeof caller.artist.store.product>>;
  try {
    row = await caller.artist.store.product({ productId });
  } catch (e) {
    if (
      e instanceof TRPCError &&
      (e.code === "NOT_FOUND" || e.code === "BAD_REQUEST")
    ) {
      notFound();
    }
    throw e;
  }

  return (
    <ProductDetailScreen
      product={toPurchaseProduct(row)}
      producer={toProducer(row)}
      productId={productId}
      studioId={row.producerId}
      taxMode={coerceTaxMode(row.producerTaxMode)}
      taxRatePct={Math.max(0, Math.min(100, Math.round(row.producerTaxRatePct)))}
      targetProjects={row.targetProjects.map((project) => ({
        id: project.id,
        title: project.title,
        lifecycleStatus: project.lifecycleStatus,
        workflowStage: project.workflowStage,
        updatedAtIso: project.updatedAt.toISOString(),
      }))}
    />
  );
}
