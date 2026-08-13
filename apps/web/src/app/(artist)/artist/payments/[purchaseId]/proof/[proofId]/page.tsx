import { auth } from "~/server/auth/clerk-identity";
import { TRPCError } from "@trpc/server";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { ProofRecordScreen } from "~/components/artist/purchase/proof-record-screen";
import { appRouter } from "~/server/trpc/routers/_app";

type PageProps = {
  params: Promise<{ purchaseId: string; proofId: string }>;
};

export const metadata: Metadata = { title: "Payment proof" };

export default async function ArtistPaymentProofRecordPage({ params }: PageProps) {
  const { userId } = await auth();
  if (!userId) notFound();
  const { purchaseId, proofId } = await params;

  try {
    const data = await appRouter
      .createCaller({ userId })
      .artist.purchase.proofOfPayment.state({ purchaseId });
    const exact = data.proofs.find((proof) => proof.proofId === proofId);
    if (!exact) notFound();

    return (
      <ProofRecordScreen
        purchaseId={data.purchaseId}
        studioId={data.producerId}
        productName={data.productName}
        producerName={data.producerName}
        currency={data.currency}
        proof={{
          proofId: exact.proofId,
          installmentId: exact.installmentId,
          installmentPosition: exact.installmentPosition,
          amountCents: exact.amountCents,
          status: exact.status,
          createdAt: exact.createdAt,
          originalFileName: exact.originalFileName,
          evidenceUrl: exact.evidenceUrl,
        }}
        totalCents={data.totalCents}
        verifiedCents={data.paidCents}
        remainingCents={data.remainingCents}
        paidInFull={data.paidInFull}
        replacementUploadAvailable={
          exact.status === "rejected" &&
          data.installmentId === exact.installmentId &&
          data.proofUploadsAvailable
        }
        history={data.proofs.map((proof) => ({
          proofId: proof.proofId,
          installmentId: proof.installmentId,
          installmentPosition: proof.installmentPosition,
          amountCents: proof.amountCents,
          status: proof.status,
          createdAt: proof.createdAt,
          originalFileName: proof.originalFileName,
          evidenceUrl: proof.evidenceUrl,
        }))}
        rejectionNote={exact.rejectionNote}
      />
    );
  } catch (error) {
    if (error instanceof TRPCError && error.code === "NOT_FOUND") {
      redirect(`/artist/payments/${encodeURIComponent(purchaseId)}`);
    }
    throw error;
  }
}
