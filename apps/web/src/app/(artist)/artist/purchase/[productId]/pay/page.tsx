import { auth } from "@clerk/nextjs/server";
import { TRPCError } from "@trpc/server";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { ChoosePlanScreen } from "~/components/artist/purchase/choose-plan-screen";
import { livePlanOptions } from "~/components/artist/purchase/pay-data";
import { appRouter } from "~/server/trpc/routers/_app";

type PageProps = {
  params: Promise<{ productId: string }>;
  searchParams: Promise<{ req?: string }>;
};

export const metadata: Metadata = { title: "Choose a payment plan" };

// S7 — the approved artist chooses from the plans frozen when the request
// was sent. The live product is deliberately not read here: producer edits
// must never change an agreement already in progress.
export default async function ChoosePlanPage({ params, searchParams }: PageProps) {
  const { userId } = await auth();
  if (!userId) return null;

  const { productId } = await params;
  const { req } = await searchParams;
  if (!req) redirect(`/artist/purchase/${productId}`);

  const caller = appRouter.createCaller({ userId });
  try {
    const data = await caller.artist.purchase.paymentPlan.options({
      purchaseRequestId: req,
    });
    if (data.productId && data.productId !== productId) notFound();
    if (data.status !== "approved") {
      if (data.status === "verifying" || data.status === "paid") {
        redirect(`/artist/purchase/${productId}/pay/proof?req=${req}`);
      }
      redirect("/artist");
    }
    if (data.chosenAt) {
      redirect(`/artist/purchase/${productId}/pay/instructions?req=${req}`);
    }
    return (
      <ChoosePlanScreen
        productId={productId}
        productName={data.productName}
        producerName={data.producerName}
        purchaseRequestId={req}
        options={livePlanOptions(data.options)}
      />
    );
  } catch (error) {
    if (error instanceof TRPCError && error.code === "NOT_FOUND") notFound();
    throw error;
  }
}
