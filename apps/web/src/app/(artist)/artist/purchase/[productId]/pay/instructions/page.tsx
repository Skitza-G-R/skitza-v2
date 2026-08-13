import { auth } from "~/server/auth/clerk-identity";
import { TRPCError } from "@trpc/server";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { withArtistStudio } from "~/lib/artist-studio-context";
import { appRouter } from "~/server/trpc/routers/_app";

type PageProps = {
  params: Promise<{ productId: string }>;
  searchParams: Promise<{ req?: string; purchase?: string; studio?: string }>;
};

export const metadata: Metadata = { title: "Payment instructions" };

/** Authorized redirect from the former product-nested instructions route. */
export default async function LegacyProductPaymentInstructionsPage({
  params,
  searchParams,
}: PageProps) {
  const { userId } = await auth();
  if (!userId) notFound();
  const { productId } = await params;
  const { req, purchase, studio } = await searchParams;
  if (!req && !purchase) {
    redirect(withArtistStudio(`/artist/purchase/${encodeURIComponent(productId)}`, studio));
  }

  try {
    const caller = appRouter.createCaller({ userId });
    const data = purchase
      ? await caller.artist.purchase.paymentInstructions({ purchaseId: purchase })
      : req
        ? await caller.artist.purchase.paymentInstructions({ purchaseRequestId: req })
        : redirect(withArtistStudio(`/artist/purchase/${encodeURIComponent(productId)}`, studio));
    redirect(
      withArtistStudio(
        `/artist/payments/${encodeURIComponent(data.purchaseId)}/instructions?installment=${encodeURIComponent(data.installmentId)}`,
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
