import { auth } from "@clerk/nextjs/server";
import { TRPCError } from "@trpc/server";
import { notFound, redirect } from "next/navigation";

import { PaymentInstructionsScreen } from "~/components/artist/purchase/payment-instructions-screen";
import { paymentPlanLabel } from "~/components/artist/purchase/pay-data";
import { appRouter } from "~/server/trpc/routers/_app";

type PageProps = {
  params: Promise<{ productId: string }>;
  searchParams: Promise<{ req?: string }>;
};

// S8 — real off-app instructions for the owned, price-locked request.
// A proof already under review (or a completed balance) goes straight to S9,
// where the artist sees its current state instead of another payment prompt.
export default async function PaymentInstructionsPage({ params, searchParams }: PageProps) {
  const { userId } = await auth();
  if (!userId) return null;

  const { productId } = await params;
  const { req } = await searchParams;
  if (!req) redirect(`/artist/purchase/${productId}`);

  const caller = appRouter.createCaller({ userId });
  try {
    const data = await caller.artist.purchase.paymentInstructions({
      purchaseRequestId: req,
    });
    if (data.productId && data.productId !== productId) notFound();
    if (data.pendingProofCents > 0 || data.remainingCents <= 0) {
      redirect(`/artist/purchase/${productId}/pay/proof?req=${req}`);
    }
    if (!data.amountDueNowCents) {
      redirect(`/artist/purchase/${productId}/pay/proof?req=${req}`);
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
        purchaseRequestId={req}
        producerName={data.producerName ?? "Your producer"}
        amountDueNowCents={data.amountDueNowCents}
        paymentDetails={paymentDetails}
        productName={data.productName}
        planLabel={paymentPlanLabel(data.planKind, data.planInstallments)}
      />
    );
  } catch (error) {
    if (error instanceof TRPCError && error.code === "NOT_FOUND") notFound();
    throw error;
  }
}
