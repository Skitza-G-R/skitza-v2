import { auth } from "@clerk/nextjs/server";
import { TRPCError } from "@trpc/server";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { paymentPlanLabel } from "~/components/artist/purchase/pay-data";
import { PaymentInstructionsScreen } from "~/components/artist/purchase/payment-instructions-screen";
import { withArtistStudio } from "~/lib/artist-studio-context";
import { appRouter } from "~/server/trpc/routers/_app";

type PageProps = {
  params: Promise<{ purchaseId: string }>;
  searchParams: Promise<{ installment?: string }>;
};

export const metadata: Metadata = { title: "Payment instructions" };

export default async function ArtistPaymentInstructionsPage({
  params,
  searchParams,
}: PageProps) {
  const { userId } = await auth();
  if (!userId) notFound();
  const { purchaseId } = await params;
  const { installment } = await searchParams;
  const caller = appRouter.createCaller({ userId });

  try {
    const data = await caller.artist.purchase.paymentInstructions({
      purchaseId,
      ...(installment ? { installmentId: installment } : {}),
    });

    const proofQuery = new URLSearchParams({ installment: data.installmentId });
    return (
      <PaymentInstructionsScreen
        productId={data.productId ?? "private-offer"}
        studioId={data.producerId}
        purchaseId={data.purchaseId}
        installmentId={data.installmentId}
        producerName={data.producerName ?? "Your producer"}
        amountDueNowCents={data.amountDueNowCents}
        currency={data.currency}
        paymentDetails={{
          bankTransfer: data.bankTransfer ?? undefined,
          bitPhone: data.bitPhone ?? undefined,
          note: data.note ?? undefined,
        }}
        productName={data.productName}
        planLabel={paymentPlanLabel(data.planKind, data.planInstallments)}
        proofUploadsAvailable={data.proofUploadsAvailable}
        summaryHref={withArtistStudio(
          `/artist/payments/${encodeURIComponent(data.purchaseId)}`,
          data.producerId,
        )}
        proofHref={withArtistStudio(
          `/artist/payments/${encodeURIComponent(data.purchaseId)}/proof/new?${proofQuery.toString()}`,
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
