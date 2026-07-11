import { auth } from "@clerk/nextjs/server";
import { TRPCError } from "@trpc/server";
import { notFound, redirect } from "next/navigation";

import {
  PurchaseRequestDetail,
  type PurchaseRequestDetailData,
} from "~/components/dashboard/requests/purchase-request-detail";
import type { PaymentProofReviewData } from "~/components/dashboard/requests/payment-proof-review";
import { ProofQueueRefresh } from "~/components/dashboard/requests/proof-queue-refresh";
import { SetTopBarBreadcrumb } from "~/components/shell/topbar-breadcrumb-context";
import { appRouter } from "~/server/trpc/routers/_app";

export default async function PurchaseRequestDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");
  const { id } = await params;
  const query = await searchParams;
  const requestedProofId =
    typeof query.proof === "string" && query.proof.length > 0 ? query.proof : undefined;
  const caller = appRouter.createCaller({ userId });

  let detail: PurchaseRequestDetailData;
  let paymentProof: PaymentProofReviewData | null = null;
  try {
    const [requestDetail, pending] = await Promise.all([
      caller.producer.purchase.get({ id }),
      caller.producer.purchase.proofOfPayment.pending({ purchaseRequestId: id }),
    ]);
    detail = requestDetail;

    const selectedProof = requestedProofId
      ? pending.proofs.find((proof) => proof.proofId === requestedProofId)
      : pending.proofs[0];

    // A proof ID in the URL is trusted only after it appears in the
    // producer-owned, request-filtered pending result. Foreign, stale, and
    // guessed IDs all become the same 404 without a metadata or URL leak.
    if (requestedProofId && !selectedProof) notFound();

    if (pending.available && selectedProof) {
      const signedView = await caller.producer.purchase.proofOfPayment.view({
        proofId: selectedProof.proofId,
      });
      paymentProof = {
        ...selectedProof,
        signedUrl: signedView.url,
        expiresInSeconds: signedView.expiresInSeconds,
      };
    }
  } catch (error) {
    // Treat every missing or foreign request as a 404 so a guessed URL
    // cannot reveal whether another producer's request exists.
    if (error instanceof TRPCError && (error.code === "FORBIDDEN" || error.code === "NOT_FOUND")) {
      notFound();
    }
    throw error;
  }

  return (
    <>
      <ProofQueueRefresh enabled={!paymentProof} />
      <SetTopBarBreadcrumb crumbs={[{ label: detail.request.artistName }]} />
      <PurchaseRequestDetail detail={detail} paymentProof={paymentProof} />
    </>
  );
}
