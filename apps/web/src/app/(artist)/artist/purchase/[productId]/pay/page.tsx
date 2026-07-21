import { auth } from "@clerk/nextjs/server";
import { TRPCError } from "@trpc/server";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { ChoosePlanScreen } from "~/components/artist/purchase/choose-plan-screen";
import { livePlanOptions } from "~/components/artist/purchase/pay-data";
import { withArtistStudio } from "~/lib/artist-studio-context";
import { appRouter } from "~/server/trpc/routers/_app";

type PageProps = {
  params: Promise<{ productId: string }>;
  searchParams: Promise<{ req?: string; studio?: string }>;
};

export const metadata: Metadata = { title: "Choose a payment plan" };

// The approved artist chooses only from the server-enabled plan options.
// Selection is carried to the exact agreement preview; nothing persists here.
export default async function ChoosePlanPage({ params, searchParams }: PageProps) {
  const { userId } = await auth();
  if (!userId) return null;

  const { productId } = await params;
  const { req, studio } = await searchParams;
  if (!req) redirect(withArtistStudio(`/artist/purchase/${productId}`, studio));

  const caller = appRouter.createCaller({ userId });
  try {
    const data = await caller.artist.purchase.paymentPlan.options({
      purchaseRequestId: req,
    });
    if (data.productId && data.productId !== productId) notFound();
    if (data.status !== "approved") {
      redirect(withArtistStudio("/artist", data.producerId));
    }
    return (
      <ChoosePlanScreen
        productId={productId}
        studioId={data.producerId}
        productName={data.productName}
        producerName={data.producerName}
        purchaseRequestId={req}
        options={livePlanOptions(data.options)}
        currency={data.currency}
      />
    );
  } catch (error) {
    if (error instanceof TRPCError && error.code === "NOT_FOUND") notFound();
    throw error;
  }
}
