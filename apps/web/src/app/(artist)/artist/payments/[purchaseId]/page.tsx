import { auth } from "~/server/auth/clerk-identity";
import { TRPCError } from "@trpc/server";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import {
  findArtistPaymentRecord,
  recordUsesProofFlow,
} from "~/components/artist/payments/artist-payment-record";
import { PaymentSummaryScreen } from "~/components/artist/purchase/payment-summary-screen";
import {
  allPaymentsBucket,
  toPaymentHistoryViewData,
} from "~/components/payments/payment-history-adapter";
import { appRouter } from "~/server/trpc/routers/_app";

type PageProps = {
  params: Promise<{ purchaseId: string }>;
};

export const metadata: Metadata = { title: "Payment summary" };

const DETAIL_SECTION = {
  id: "artist-payment-record",
  eyebrow: "Agreement",
  title: "Payment record",
  description: "The complete frozen agreement and money history.",
  emptyTitle: "Payment record not found",
  emptyDescription: "This agreement is not available.",
} as const;

/** Standing entry for one owned agreement and its proof history. */
export default async function ArtistPurchasePaymentPage({ params }: PageProps) {
  const { userId } = await auth();
  if (!userId) notFound();
  const { purchaseId } = await params;
  const caller = appRouter.createCaller({ userId });

  try {
    const model = await caller.artist.purchase.payments();
    const sections = [
      toPaymentHistoryViewData(
        allPaymentsBucket(model.projects, model.totals),
        DETAIL_SECTION,
        "artist",
      ),
    ];
    const record = findArtistPaymentRecord(sections, purchaseId);
    if (!record) notFound();
    const { purchase } = record;
    const studioId = purchase.studioId;
    if (!studioId) notFound();
    const state = recordUsesProofFlow(purchase)
      ? await caller.artist.purchase.proofOfPayment.state({ purchaseId })
      : null;

    return (
      <PaymentSummaryScreen
        purchaseId={purchase.id}
        studioId={studioId}
        productName={purchase.title}
        producerName={purchase.counterpartyLabel ?? "Your producer"}
        currency={purchase.currency}
        totalCents={purchase.totalCents}
        verifiedCents={purchase.paidCents}
        remainingCents={purchase.totalRemainingCents}
        currentInstallmentPosition={state?.installmentPosition ?? null}
        recordStatus={purchase.recordStatus}
        proofUploadAvailability={state?.proofUploadAvailability ?? null}
        proofs={
          state?.proofs.map((proof) => ({
            proofId: proof.proofId,
            installmentId: proof.installmentId,
            installmentPosition: proof.installmentPosition,
            amountCents: proof.amountCents,
            status: proof.status,
            createdAt: proof.createdAt,
          })) ?? []
        }
        purchaseRecord={purchase}
      />
    );
  } catch (error) {
    if (error instanceof TRPCError && error.code === "NOT_FOUND") notFound();
    throw error;
  }
}
