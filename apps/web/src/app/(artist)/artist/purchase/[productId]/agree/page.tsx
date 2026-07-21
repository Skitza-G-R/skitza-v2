import { auth } from "@clerk/nextjs/server";
import { TRPCError } from "@trpc/server";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { parsePaymentPlanSearch } from "~/components/artist/purchase/pay-data";
import { ReviewAgreeScreen } from "~/components/artist/purchase/review-agree-screen";
import { withArtistStudio } from "~/lib/artist-studio-context";
import { appRouter } from "~/server/trpc/routers/_app";

type PageProps = {
  params: Promise<{ productId: string }>;
  searchParams: Promise<{
    req?: string;
    plan?: string;
    installments?: string;
    studio?: string;
  }>;
};

export const metadata: Metadata = { title: "Review and accept" };

// Final acceptance boundary. The preview is calculated server-side from the
// approved request, current product terms, selected enabled plan, and exact
// target. The mutation receives the preview digest so a concurrent change
// fails closed instead of accepting terms the artist did not see.
export default async function PurchaseAgreePage({ params, searchParams }: PageProps) {
  const { userId } = await auth();
  if (!userId) return null;

  const { productId } = await params;
  const query = await searchParams;
  if (!query.req) {
    redirect(withArtistStudio(`/artist/purchase/${encodeURIComponent(productId)}`, query.studio));
  }

  const paymentPlan = parsePaymentPlanSearch(query);
  if (!paymentPlan) {
    redirect(
      withArtistStudio(
        `/artist/purchase/${encodeURIComponent(productId)}/pay?req=${encodeURIComponent(query.req)}`,
        query.studio,
      ),
    );
  }

  const caller = appRouter.createCaller({ userId });
  try {
    const preview = await caller.artist.purchase.acceptance.preview({
      purchaseRequestId: query.req,
      paymentPlan,
    });
    if (preview.productId !== productId) notFound();

    return (
      <ReviewAgreeScreen
        preview={preview}
        studioId={preview.producerId}
        purchaseRequestId={query.req}
        paymentPlan={paymentPlan}
      />
    );
  } catch (error) {
    if (error instanceof TRPCError && error.code === "NOT_FOUND") notFound();
    throw error;
  }
}
