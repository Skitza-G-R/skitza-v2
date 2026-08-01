import { auth } from "@clerk/nextjs/server";
import { TRPCError } from "@trpc/server";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { PaymentSummaryScreen } from "~/components/artist/purchase/payment-summary-screen";
import { appRouter } from "~/server/trpc/routers/_app";

type PageProps = {
  params: Promise<{ purchaseId: string }>;
  searchParams: Promise<{ notice?: string }>;
};

export const metadata: Metadata = { title: "Payment summary" };

/** Standing entry for one owned accepted purchase and its proof history. */
export default async function ArtistPurchasePaymentPage({ params, searchParams }: PageProps) {
  const { userId } = await auth();
  if (!userId) notFound();
  const { purchaseId } = await params;
  const { notice } = await searchParams;
  const caller = appRouter.createCaller({ userId });

  try {
    const state = await caller.artist.purchase.proofOfPayment.state({ purchaseId });
    let paymentInstructionsAvailable = false;
    if (state.proofUploadsAvailable) {
      try {
        const instructions = await caller.artist.purchase.paymentInstructions({
          purchaseId,
          installmentId: state.installmentId,
        });
        paymentInstructionsAvailable =
          instructions.hasDetails &&
          Boolean(instructions.bankTransfer?.trim() || instructions.bitPhone?.trim());
      } catch (error) {
        if (!(error instanceof TRPCError) || error.code !== "NOT_FOUND") throw error;
      }
    }

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
        paymentInstructionsAvailable={paymentInstructionsAvailable}
        notice={notice === "no-instructions" ? "no-instructions" : undefined}
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
