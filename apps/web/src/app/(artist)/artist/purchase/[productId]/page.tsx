import { auth } from "@clerk/nextjs/server";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { TRPCError } from "@trpc/server";

import { ProductDetailScreen } from "~/components/artist/purchase/product-detail-screen";
import { toProducer, toPurchaseProduct } from "~/lib/purchase/product-mapping";
import { appRouter } from "~/server/trpc/routers/_app";

type PageProps = { params: Promise<{ productId: string }> };

export const metadata: Metadata = { title: "Product details" };

// S3 — Product detail + "Request to book" (Commit · ENTRY). The funnel's
// front door: the artist reads the offer, sees the price (which locks at
// request time), and starts the purchase. The "Request to book" CTA routes
// to S4 (Review & agree), where the request actually fires Gate 1.
//
// Real BE-1 data (SK-46): the product + producer come from
// `artist.store.product` (ownership-guarded), and `pendingRequest` from
// `artist.purchase.pending` — one open request per studio while Gate 1
// is in review.
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

  const { pending } = await caller.artist.purchase.pending({
    producerId: row.producerId,
  });

  return (
    <ProductDetailScreen
      product={toPurchaseProduct(row)}
      producer={toProducer(row)}
      productId={productId}
      pendingRequest={Boolean(pending)}
    />
  );
}
