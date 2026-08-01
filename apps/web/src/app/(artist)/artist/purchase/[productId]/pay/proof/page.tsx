import { auth } from "@clerk/nextjs/server";
import { TRPCError } from "@trpc/server";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { withArtistStudio } from "~/lib/artist-studio-context";
import { appRouter } from "~/server/trpc/routers/_app";

type PageProps = {
  params: Promise<{ productId: string }>;
  searchParams: Promise<{ purchase?: string; installment?: string; studio?: string }>;
};

export const metadata: Metadata = { title: "Upload payment proof" };

/** Authorized redirect from the former product-nested proof route. */
export default async function LegacyProductProofPage({ params, searchParams }: PageProps) {
  const { userId } = await auth();
  if (!userId) notFound();
  const { productId } = await params;
  const { purchase, installment, studio } = await searchParams;
  if (!purchase) {
    redirect(withArtistStudio(`/artist/purchase/${encodeURIComponent(productId)}`, studio));
  }

  try {
    const data = await appRouter
      .createCaller({ userId })
      .artist.purchase.proofOfPayment.state({
        purchaseId: purchase,
        ...(installment ? { installmentId: installment } : {}),
      });
    if (data.productId && data.productId !== productId) notFound();
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
    const query = new URLSearchParams({ installment: data.installmentId });
    redirect(
      withArtistStudio(
        data.proofUploadsAvailable
          ? `/artist/payments/${encodeURIComponent(data.purchaseId)}/proof/new?${query.toString()}`
          : `/artist/payments/${encodeURIComponent(data.purchaseId)}`,
        data.producerId,
      ),
    );
  } catch (error) {
    if (error instanceof TRPCError && error.code === "NOT_FOUND") {
      redirect(withArtistStudio("/artist/store?notice=unavailable", studio));
    }
    throw error;
  }
}
