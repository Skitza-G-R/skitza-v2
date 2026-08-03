import { auth } from "@clerk/nextjs/server";
import { TRPCError } from "@trpc/server";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { UploadProofScreen } from "~/components/artist/purchase/upload-proof-screen";
import { withArtistStudio } from "~/lib/artist-studio-context";
import { appRouter } from "~/server/trpc/routers/_app";

type PageProps = {
  params: Promise<{ purchaseId: string }>;
  searchParams: Promise<{ installment?: string }>;
};

export const metadata: Metadata = { title: "Upload payment proof" };

export default async function ArtistNewPaymentProofPage({ params, searchParams }: PageProps) {
  const { userId } = await auth();
  if (!userId) notFound();
  const { purchaseId } = await params;
  const { installment } = await searchParams;
  const caller = appRouter.createCaller({ userId });

  try {
    const data = await caller.artist.purchase.proofOfPayment.state({
      purchaseId,
      ...(installment ? { installmentId: installment } : {}),
    });
    const installmentProofs = data.proofs.filter(
      (proof) => proof.installmentId === data.installmentId,
    );
    const latest = installmentProofs.at(-1) ?? null;

    if (latest?.status === "pending" || latest?.status === "confirmed") {
      redirect(
        withArtistStudio(
          `/artist/payments/${encodeURIComponent(data.purchaseId)}/proof/${encodeURIComponent(latest.proofId)}`,
          data.producerId,
        ),
      );
    }
    if (!data.proofUploadsAvailable) {
      redirect(
        withArtistStudio(
          `/artist/payments/${encodeURIComponent(data.purchaseId)}`,
          data.producerId,
        ),
      );
    }

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
        rejectionNote={
          latest?.status === "rejected" ? (latest.rejectionNote ?? undefined) : undefined
        }
        backHref={withArtistStudio(
          `/artist/payments/${encodeURIComponent(data.purchaseId)}/instructions?installment=${encodeURIComponent(data.installmentId)}`,
          data.producerId,
        )}
      />
    );
  } catch (error) {
    if (error instanceof TRPCError && error.code === "NOT_FOUND") {
      redirect(`/artist/payments/${encodeURIComponent(purchaseId)}`);
    }
    throw error;
  }
}
