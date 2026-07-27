import { auth } from "@clerk/nextjs/server";
import { TRPCError } from "@trpc/server";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";

import { PaymentProofReview } from "~/components/dashboard/payments/payment-proof-review";
import { ProofQueueRefresh } from "~/components/dashboard/payments/proof-queue-refresh";
import { SetTopBarBreadcrumb } from "~/components/shell/topbar-breadcrumb-context";
import { producerPaymentProofQueueVersion } from "~/server/runtime/queue-version";
import { appRouter } from "~/server/trpc/routers/_app";

type PageProps = { params: Promise<{ proofId: string }> };

export default async function PaymentProofPage({ params }: PageProps) {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");
  const { proofId } = await params;
  if (!z.string().uuid().safeParse(proofId).success) notFound();

  try {
    const review = await appRouter
      .createCaller({ userId })
      .producer.purchase.proofOfPayment.get({ proofId });
    return (
      <>
        <SetTopBarBreadcrumb crumbs={[{ label: review.proof.artistName }]} />
        <main className="mx-auto w-full max-w-[1180px] px-4 py-6 sm:px-6 sm:py-9">
          <ProofQueueRefresh
            kind="payment-proof"
            proofId={review.proof.proofId}
            initialVersion={producerPaymentProofQueueVersion(
              review.proof.status === "pending" ? [review.proof.proofId] : [],
              review.proof.proofId,
            )}
            enabled={review.proof.status === "pending"}
          />
          <Link
            href="/dashboard/payments"
            className="mb-4 inline-flex min-h-11 items-center text-sm font-semibold text-[rgb(var(--fg-muted))] hover:text-[rgb(var(--fg-default))]"
          >
            ← Back to Payments
          </Link>
          <PaymentProofReview review={review} />
        </main>
      </>
    );
  } catch (error) {
    if (error instanceof TRPCError && (error.code === "NOT_FOUND" || error.code === "FORBIDDEN"))
      notFound();
    throw error;
  }
}
