import { auth } from "@clerk/nextjs/server";
import { TRPCError } from "@trpc/server";
import { notFound, redirect } from "next/navigation";

import { withArtistStudio } from "~/lib/artist-studio-context";
import { appRouter } from "~/server/trpc/routers/_app";

type PageProps = {
  params: Promise<{ purchaseId: string }>;
  searchParams: Promise<{ installment?: string }>;
};

/** Compatibility route for links created before proof records had stable URLs. */
export default async function LegacyArtistPurchaseProofPage({
  params,
  searchParams,
}: PageProps) {
  const { userId } = await auth();
  if (!userId) notFound();
  const { purchaseId } = await params;
  const { installment } = await searchParams;

  try {
    const data = await appRouter
      .createCaller({ userId })
      .artist.purchase.proofOfPayment.state({
        purchaseId,
        ...(installment ? { installmentId: installment } : {}),
      });
    const latest = data.proofs
      .filter((proof) => proof.installmentId === data.installmentId)
      .at(-1);
    if (latest) {
      redirect(
        withArtistStudio(
          `/artist/payments/${encodeURIComponent(data.purchaseId)}/proof/${encodeURIComponent(latest.proofId)}`,
          data.producerId,
        ),
      );
    }
    if (data.proofUploadsAvailable) {
      const query = new URLSearchParams({ installment: data.installmentId });
      redirect(
        withArtistStudio(
          `/artist/payments/${encodeURIComponent(data.purchaseId)}/proof/new?${query.toString()}`,
          data.producerId,
        ),
      );
    }
    redirect(
      withArtistStudio(
        `/artist/payments/${encodeURIComponent(data.purchaseId)}`,
        data.producerId,
      ),
    );
  } catch (error) {
    if (error instanceof TRPCError && error.code === "NOT_FOUND") notFound();
    throw error;
  }
}
