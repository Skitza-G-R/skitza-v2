import { auth } from "@clerk/nextjs/server";
import { TRPCError } from "@trpc/server";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import type { ProofStatus } from "~/components/artist/purchase/pay-data";
import { UploadProofScreen } from "~/components/artist/purchase/upload-proof-screen";
import { appRouter } from "~/server/trpc/routers/_app";

type PageProps = {
  params: Promise<{ productId: string }>;
  searchParams: Promise<{ req?: string }>;
};

export const metadata: Metadata = { title: "Upload payment proof" };

// S9 — the real private proof ledger for this owned purchase. Storage keys
// remain server-only; the client receives only safe status/amount metadata.
export default async function PurchaseProofPage({ params, searchParams }: PageProps) {
  const { userId } = await auth();
  if (!userId) return null;

  const { productId } = await params;
  const { req } = await searchParams;
  if (!req) redirect(`/artist/purchase/${productId}`);

  const caller = appRouter.createCaller({ userId });
  try {
    const data = await caller.artist.purchase.proofOfPayment.state({
      purchaseRequestId: req,
    });
    if (data.productId && data.productId !== productId) notFound();
    if (!(["approved", "verifying", "paid"] as string[]).includes(data.requestStatus)) {
      redirect("/artist");
    }
    if (!data.proofUploadsAvailable) {
      redirect(`/artist/purchase/${productId}/pay/instructions?req=${req}`);
    }
    if (!data.planChosenAt) {
      redirect(`/artist/purchase/${productId}/pay?req=${req}`);
    }

    const proofs: Array<{
      id: string;
      amountCents: number;
      status: ProofStatus;
    }> = data.proofs.map((proof) => ({
      id: proof.id,
      amountCents: proof.amountCents,
      status:
        proof.status === "pending"
          ? "awaiting"
          : proof.status === "confirmed"
            ? "paid"
            : "rejected",
    }));
    const latest = data.proofs.at(-1);
    const initialStatus: ProofStatus = data.paidInFull
      ? "paid"
      : latest?.status === "pending"
        ? "awaiting"
        : latest?.status === "rejected"
          ? "rejected"
          : "empty";
    const bookingHref = data.projectId
      ? `/artist/book?studio=${data.producerId}&project=${data.projectId}`
      : undefined;

    return (
      <UploadProofScreen
        productName={data.productName}
        producerName={data.producerName}
        purchaseRequestId={req}
        proofs={proofs}
        paidCents={data.paidCents}
        totalCents={data.totalCents}
        thisProofCents={data.amountDueNowCents}
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
