import { auth } from "@clerk/nextjs/server";
import { TRPCError } from "@trpc/server";
import { notFound } from "next/navigation";

import type { ProofStatus } from "~/components/artist/purchase/pay-data";
import { UploadProofScreen } from "~/components/artist/purchase/upload-proof-screen";
import { appRouter } from "~/server/trpc/routers/_app";

type PageProps = {
  params: Promise<{ purchaseId: string }>;
  searchParams: Promise<{ installment?: string }>;
};

export default async function ArtistPrivateOfferProofPage({ params, searchParams }: PageProps) {
  const { userId } = await auth();
  if (!userId) notFound();
  const { purchaseId } = await params;
  const { installment } = await searchParams;
  try {
    const data = await appRouter.createCaller({ userId }).artist.purchase.proofOfPayment.state({
      purchaseId,
      ...(installment ? { installmentId: installment } : {}),
    });
    const latest = data.proofs.filter((proof) => proof.installmentId === data.installmentId).at(-1);
    const status: ProofStatus = data.paidInFull
      ? "paid"
      : latest?.status === "pending"
        ? "awaiting"
        : latest?.status === "rejected"
          ? "rejected"
          : "empty";
    return (
      <UploadProofScreen
        studioId={data.producerId}
        productName={data.productName}
        producerName={data.producerName}
        purchaseId={data.purchaseId}
        installmentId={data.installmentId}
        installmentPosition={data.installmentPosition}
        proofs={data.proofs.map((proof) => ({
          id: proof.proofId,
          amountCents: proof.amountCents,
          status:
            proof.status === "pending"
              ? "awaiting"
              : proof.status === "confirmed"
                ? "paid"
                : "rejected",
          evidenceUrl: proof.evidenceUrl,
          originalFileName: proof.originalFileName,
          createdAt: proof.createdAt,
          rejectionNote: proof.rejectionNote,
        }))}
        paidCents={data.paidCents}
        totalCents={data.totalCents}
        thisProofCents={data.amountDueNowCents}
        currency={data.currency}
        proofUploadsAvailable={data.proofUploadsAvailable}
        bookingHref={
          data.installmentPosition > 1 || data.paidInFull
            ? `/artist/book?studio=${data.producerId}&project=${data.projectId}`
            : undefined
        }
        status={status}
        rejectionNote={latest?.rejectionNote ?? undefined}
      />
    );
  } catch (error) {
    if (error instanceof TRPCError && error.code === "NOT_FOUND") notFound();
    throw error;
  }
}
