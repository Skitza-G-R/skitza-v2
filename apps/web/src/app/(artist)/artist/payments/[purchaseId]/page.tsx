import { auth } from "@clerk/nextjs/server";
import { TRPCError } from "@trpc/server";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { PaymentSummaryScreen } from "~/components/artist/purchase/payment-summary-screen";
import { appRouter } from "~/server/trpc/routers/_app";

type PageProps = {
  params: Promise<{ purchaseId: string }>;
};

export const metadata: Metadata = { title: "Payment summary" };

/** Standing entry for one owned accepted purchase and its proof history. */
export default async function ArtistPurchasePaymentPage({ params }: PageProps) {
  const { userId } = await auth();
  if (!userId) notFound();
  const { purchaseId } = await params;
  const caller = appRouter.createCaller({ userId });

  try {
    const state = await caller.artist.purchase.proofOfPayment.state({ purchaseId });

    return (
      <PaymentSummaryScreen
        purchaseId={state.purchaseId}
        studioId={state.producerId}
        productName={state.productName}
        producerName={state.producerName}
        currency={state.currency}
        totalCents={state.totalCents}
        verifiedCents={state.paidCents}
        remainingCents={state.remainingCents}
        currentInstallmentPosition={state.installmentPosition}
        proofUploadsAvailable={state.proofUploadsAvailable}
        proofs={state.proofs.map((proof) => ({
          proofId: proof.proofId,
          installmentId: proof.installmentId,
          installmentPosition: proof.installmentPosition,
          amountCents: proof.amountCents,
          status: proof.status,
          createdAt: proof.createdAt,
        }))}
      />
    );
  } catch (error) {
    if (error instanceof TRPCError && error.code === "NOT_FOUND") notFound();
    throw error;
  }
}
