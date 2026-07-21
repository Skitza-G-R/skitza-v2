import { auth } from "@clerk/nextjs/server";
import { TRPCError } from "@trpc/server";
import { notFound, redirect } from "next/navigation";

import { paymentPlanLabel } from "~/components/artist/purchase/pay-data";
import { PaymentInstructionsScreen } from "~/components/artist/purchase/payment-instructions-screen";
import { withArtistStudio } from "~/lib/artist-studio-context";
import { appRouter } from "~/server/trpc/routers/_app";

type PageProps = { params: Promise<{ purchaseId: string }> };

/** Exact accepted-purchase payment entry, including paid private offers. */
export default async function ArtistPurchasePaymentPage({ params }: PageProps) {
  const { userId } = await auth();
  if (!userId) notFound();
  const { purchaseId } = await params;
  const caller = appRouter.createCaller({ userId });
  let data: Awaited<ReturnType<typeof caller.artist.purchase.paymentInstructions>>;
  try {
    data = await caller.artist.purchase.paymentInstructions({ purchaseId });
  } catch (error) {
    if (!(error instanceof TRPCError) || error.code !== "NOT_FOUND") throw error;
    try {
      const proofState = await caller.artist.purchase.proofOfPayment.state({ purchaseId });
      const query = new URLSearchParams({ installment: proofState.installmentId });
      redirect(
        withArtistStudio(
          `/artist/payments/${encodeURIComponent(proofState.purchaseId)}/proof?${query.toString()}`,
          proofState.producerId,
        ),
      );
    } catch (proofError) {
      if (proofError instanceof TRPCError && proofError.code === "NOT_FOUND") notFound();
      throw proofError;
    }
  }

  const paymentDetails = data.hasDetails
    ? {
        bankTransfer: data.bankTransfer ?? undefined,
        bitPhone: data.bitPhone ?? undefined,
        note: data.note ?? undefined,
      }
    : null;
  const query = new URLSearchParams({ installment: data.installmentId });
  return (
    <PaymentInstructionsScreen
      productId={data.productId ?? "private-offer"}
      studioId={data.producerId}
      purchaseId={data.purchaseId}
      installmentId={data.installmentId}
      producerName={data.producerName ?? "Your producer"}
      amountDueNowCents={data.amountDueNowCents}
      currency={data.currency}
      paymentDetails={paymentDetails}
      productName={data.productName}
      planLabel={paymentPlanLabel(data.planKind, data.planInstallments)}
      proofUploadsAvailable={data.proofUploadsAvailable}
      proofHref={withArtistStudio(
        `/artist/payments/${encodeURIComponent(data.purchaseId)}/proof?${query.toString()}`,
        data.producerId,
      )}
    />
  );
}
