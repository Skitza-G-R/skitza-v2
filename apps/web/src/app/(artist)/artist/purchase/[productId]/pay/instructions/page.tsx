import { auth } from "@clerk/nextjs/server";
import { TRPCError } from "@trpc/server";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { PaymentInstructionsScreen } from "~/components/artist/purchase/payment-instructions-screen";
import { paymentPlanLabel } from "~/components/artist/purchase/pay-data";
import { appRouter } from "~/server/trpc/routers/_app";

type PageProps = {
  params: Promise<{ productId: string }>;
  searchParams: Promise<{ req?: string; purchase?: string }>;
};

export const metadata: Metadata = { title: "Payment instructions" };

// S8 — current off-app instructions for the owned, accepted purchase.
// The server returns only a due, still-payable installment; terminal,
// proof-under-review, and future installments never render instructions.
export default async function PaymentInstructionsPage({ params, searchParams }: PageProps) {
  const { userId } = await auth();
  if (!userId) return null;

  const { productId } = await params;
  const { req, purchase } = await searchParams;
  if (!req && !purchase) redirect(`/artist/purchase/${productId}`);

  const caller = appRouter.createCaller({ userId });
  try {
    const data = purchase
      ? await caller.artist.purchase.paymentInstructions({ purchaseId: purchase })
      : req
        ? await caller.artist.purchase.paymentInstructions({ purchaseRequestId: req })
        : redirect(`/artist/purchase/${productId}`);
    if (data.productId && data.productId !== productId) notFound();
    if (!data.amountDueNowCents) {
      if (data.proofUploadsAvailable) {
        redirect(`/artist/purchase/${productId}/pay/proof?req=${req ?? ""}`);
      }
      redirect("/artist");
    }
    if (data.proofUploadsAvailable && (data.pendingProofCents > 0 || data.remainingCents <= 0)) {
      redirect(`/artist/purchase/${productId}/pay/proof?req=${req ?? ""}`);
    }

    const paymentDetails = data.hasDetails
      ? {
          bankTransfer: data.bankTransfer ?? undefined,
          bitPhone: data.bitPhone ?? undefined,
          note: data.note ?? undefined,
        }
      : null;

    return (
      <PaymentInstructionsScreen
        productId={productId}
        purchaseRequestId={req ?? ""}
        producerName={data.producerName ?? "Your producer"}
        amountDueNowCents={data.amountDueNowCents}
        currency={data.currency}
        paymentDetails={paymentDetails}
        productName={data.productName}
        planLabel={paymentPlanLabel(data.planKind, data.planInstallments)}
        proofUploadsAvailable={data.proofUploadsAvailable}
      />
    );
  } catch (error) {
    if (error instanceof TRPCError && error.code === "NOT_FOUND") notFound();
    throw error;
  }
}
