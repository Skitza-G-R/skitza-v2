import { auth } from "~/server/auth/clerk-identity";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { TRPCError } from "@trpc/server";

import { ProfessionalProductDetail } from "~/components/artist/purchase/professional-product-detail";
import { toPurchaseProduct } from "~/lib/purchase/product-mapping";
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
    if (e instanceof TRPCError) {
      if (e.code === "BAD_REQUEST") {
        redirect("/artist/store?notice=unavailable");
      }
      if (e.code === "NOT_FOUND") notFound();
    }
    throw e;
  }
  const activePurchase = await caller.artist.purchase.activeForStudio({
    producerId: row.producerId,
  });

  return (
    <ProfessionalProductDetail
      product={toPurchaseProduct(row)}
      studioId={row.producerId}
      activePurchase={
        activePurchase.blocked ? { href: activePurchase.href, label: activePurchase.label } : null
      }
    />
  );
}
