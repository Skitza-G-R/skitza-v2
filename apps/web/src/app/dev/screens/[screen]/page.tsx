import { notFound } from "next/navigation";

import { ProductDetailScreen } from "~/components/artist/purchase/product-detail-screen";
import {
  MOCK_PRODUCER,
  MOCK_PRODUCT,
} from "~/components/artist/purchase/pay-data";

// Dev-only screen gallery for the handoff-4 wave (2026-07-05). Renders the
// funnel screens with mock props at /dev/screens/<name> so visual QA can
// screenshot every state at 390×844 WITHOUT a Clerk session. Hard 404 in
// production — this never ships to users. Extend the map as waves land.
type Params = { params: Promise<{ screen: string }> };

export default async function DevScreenPage({ params }: Params) {
  if (process.env.NODE_ENV === "production") notFound();
  const { screen } = await params;

  switch (screen) {
    case "s3":
      return (
        <ProductDetailScreen
          product={MOCK_PRODUCT}
          producer={MOCK_PRODUCER}
          productId="00000000-0000-4000-8000-000000000000"
        />
      );
    case "s3-pending":
      return (
        <ProductDetailScreen
          product={MOCK_PRODUCT}
          producer={MOCK_PRODUCER}
          productId="00000000-0000-4000-8000-000000000000"
          pendingRequest
        />
      );
    default:
      notFound();
  }
}
