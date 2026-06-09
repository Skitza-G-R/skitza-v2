import { auth } from "@clerk/nextjs/server";

import {
  MOCK_PRODUCER,
  MOCK_PRODUCT,
} from "~/components/artist/purchase/purchase-data";
import { ProductDetailScreen } from "~/components/artist/purchase/product-detail-screen";

type PageProps = { params: Promise<{ productId: string }> };

// S3 — Product detail + "Request to book" (Commit · ENTRY). The funnel's
// front door: the artist reads the offer, sees the price (which locks at
// request time), and starts the purchase. The "Request to book" CTA routes
// to S4 (Review & agree), where the request actually fires Gate 1.
//
// BE-1 (SK-37) swap point: replace MOCK_* with the tRPC caller's real
// price-locked product snapshot + producer, and resolve `pendingRequest`
// from the artist's open-request check (one open request at a time — Gate 1
// blocks a second purchase while one is in review). The screen props don't
// change.
export default async function PurchaseEntryPage({ params }: PageProps) {
  const { userId } = await auth();
  if (!userId) return null;

  const { productId } = await params;
  const product = { ...MOCK_PRODUCT, id: productId };
  const producer = MOCK_PRODUCER;
  const pendingRequest = false;

  return (
    <ProductDetailScreen
      product={product}
      producer={producer}
      productId={productId}
      pendingRequest={pendingRequest}
    />
  );
}
