import { auth } from "@clerk/nextjs/server";
import { TRPCError } from "@trpc/server";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import type { ProofStatus } from "~/components/artist/purchase/pay-data";
import { UploadProofScreen } from "~/components/artist/purchase/upload-proof-screen";
import { appRouter } from "~/server/trpc/routers/_app";

type PageProps = {
  params: Promise<{ productId: string }>;
  searchParams: Promise<{ purchase?: string; installment?: string }>;
};

export const metadata: Metadata = { title: "Upload payment proof" };

// The browser gets immutable proof metadata and short-lived same-origin
// evidence links only. Permanent storage identity remains server-only.
export default async function PurchaseProofPage({ params, searchParams }: PageProps) {
  const { userId } = await auth();
  if (!userId) return null;

  const { productId } = await params;
  const { purchase, installment } = await searchParams;
  if (!purchase) redirect(`/artist/purchase/${productId}`);

  const caller = appRouter.createCaller({ userId });
  try {
    const data = await caller.artist.purchase.proofOfPayment.state({
      purchaseId: purchase,
      ...(installment ? { installmentId: installment } : {}),
    });
    if (data.productId && data.productId !== productId) notFound();

    const proofs = data.proofs.map((proof) => ({
      id: proof.proofId,
      amountCents: proof.amountCents,
      status: (proof.status === "pending"
        ? "awaiting"
        : proof.status === "confirmed"
          ? "paid"
          : "rejected") as ProofStatus,
      evidenceUrl: proof.evidenceUrl,
      originalFileName: proof.originalFileName,
      createdAt: proof.createdAt,
      rejectionNote: proof.rejectionNote,
    }));
    const latest = data.proofs.filter((proof) => proof.installmentId === data.installmentId).at(-1);
    const initialStatus: ProofStatus = data.paidInFull
      ? "paid"
      : latest?.status === "pending"
        ? "awaiting"
        : latest?.status === "rejected"
          ? "rejected"
          : "empty";
    const bookingHref =
      data.installmentPosition > 1 || data.paidInFull
        ? `/artist/book?studio=${data.producerId}&project=${data.projectId}`
        : undefined;

    return (
      <UploadProofScreen
        productName={data.productName}
        producerName={data.producerName}
        purchaseId={data.purchaseId}
        installmentId={data.installmentId}
        installmentPosition={data.installmentPosition}
        proofs={proofs}
        paidCents={data.paidCents}
        totalCents={data.totalCents}
        thisProofCents={data.amountDueNowCents}
        currency={data.currency}
        proofUploadsAvailable={data.proofUploadsAvailable}
        bookingHref={bookingHref}
        status={initialStatus}
        rejectionNote={
          latest?.status === "rejected" ? (latest.rejectionNote ?? undefined) : undefined
        }
      />
    );
  } catch (error) {
    if (error instanceof TRPCError && error.code === "NOT_FOUND") notFound();
    throw error;
  }
}
