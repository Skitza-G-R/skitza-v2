import { notFound } from "next/navigation";

import {
  PurchaseStatusCard,
  type PurchaseStage,
} from "~/components/artist/home/purchase-status-card";

import { ProductDetailScreen } from "~/components/artist/purchase/product-detail-screen";
import { RequestSentScreen } from "~/components/artist/purchase/request-sent-screen";
import { ReviewAgreeScreen } from "~/components/artist/purchase/review-agree-screen";
import { buildAgreementTerms } from "~/components/artist/purchase/purchase-data";
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
    case "s4":
      return (
        <ReviewAgreeScreen
          product={MOCK_PRODUCT}
          producer={MOCK_PRODUCER}
          terms={buildAgreementTerms(MOCK_PRODUCER.name, MOCK_PRODUCT.includes)}
        />
      );
    case "s5":
      return (
        <RequestSentScreen
          product={MOCK_PRODUCT}
          producer={MOCK_PRODUCER}
          requestRef="SK-7F3QK2"
        />
      );
    default: {
      if (screen.startsWith("s6-")) {
        const stage = screen.slice(3) as PurchaseStage;
        const valid: PurchaseStage[] = [
          "pending_review",
          "awaiting_payment",
          "verifying",
          "paid",
          "declined",
        ];
        if (!valid.includes(stage)) notFound();
        return (
          <div className="mx-auto max-w-[440px] px-5 py-16">
            <PurchaseStatusCard
              stage={stage}
              productName={MOCK_PRODUCT.name}
              priceCents={MOCK_PRODUCT.priceCents}
              producerName={MOCK_PRODUCER.name}
              {...(stage === "awaiting_payment"
                ? {
                    actionHref: "/dev/screens/s3",
                    actionLabel: "Choose a payment plan",
                  }
                : stage === "paid"
                  ? { actionHref: "/dev/screens/s3", actionLabel: "Book a session" }
                  : {})}
            />
          </div>
        );
      }
      notFound();
    }
  }
}
