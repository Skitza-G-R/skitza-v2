import { auth } from "@clerk/nextjs/server";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { TRPCError } from "@trpc/server";

import { buildAgreementTerms } from "~/components/artist/purchase/purchase-data";
import { ReviewAgreeScreen } from "~/components/artist/purchase/review-agree-screen";
import { toProducer, toPurchaseProduct } from "~/lib/purchase/product-mapping";
import { commercialTermsFingerprint } from "~/lib/purchase/commercial-terms-fingerprint";
import { appRouter } from "~/server/trpc/routers/_app";

type PageProps = { params: Promise<{ productId: string }> };

export const metadata: Metadata = { title: "Review and agree" };

// S4 — Review & agree (Commit). Real BE-1 data (SK-46): price-locked
// product snapshot + producer + uploaded agreement from
// `artist.store.product`; the screen's "Send request" fires the real
// `artist.purchase.request` via the requestToBookAction server action.
export default async function PurchaseAgreePage({ params }: PageProps) {
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

  const product = toPurchaseProduct(row);
  const producer = toProducer(row);
  const terms = buildAgreementTerms(producer.name, product.includes);
  const fingerprint = commercialTermsFingerprint({
    productName: product.name,
    priceCents: product.priceCents,
    currency: product.currency,
    paymentPlans: product.paymentPlans,
    royaltyTerms: product.royaltyTerms,
    agreementText: product.agreementText,
    contractUrl: producer.agreement?.url ?? null,
  });

  return (
    <ReviewAgreeScreen
      product={product}
      producer={producer}
      terms={terms}
      commercialTermsFingerprint={fingerprint}
    />
  );
}
