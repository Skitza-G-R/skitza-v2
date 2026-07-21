import { auth } from "@clerk/nextjs/server";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { TRPCError } from "@trpc/server";

import { RequestSentScreen } from "~/components/artist/purchase/request-sent-screen";
import {
  producerHue,
  producerInitials,
} from "~/lib/_phase4-stubs/producer-color";
import { withArtistStudio } from "~/lib/artist-studio-context";
import { appRouter } from "~/server/trpc/routers/_app";

type PageProps = {
  params: Promise<{ productId: string }>;
  searchParams: Promise<{ req?: string; studio?: string }>;
};

export const metadata: Metadata = { title: "Request sent" };

// S5 — Request sent (Commit). Real BE-1 data (SK-46): the request id comes
// back from `requestToBookAction` as `?req=`; we read the row with
// `artist.purchase.get` and show the server-issued reference. Requests carry
// intent only; no commercial proposal is presented as frozen here.
export default async function PurchaseSentPage({ params, searchParams }: PageProps) {
  const { userId } = await auth();
  if (!userId) return null;

  const { productId } = await params;
  const { req, studio } = await searchParams;
  if (!req) redirect(withArtistStudio(`/artist/purchase/${productId}`, studio));

  const caller = appRouter.createCaller({ userId });

  let request: Awaited<ReturnType<typeof caller.artist.purchase.get>>;
  try {
    request = await caller.artist.purchase.get({ purchaseRequestId: req });
  } catch (e) {
    if (
      e instanceof TRPCError &&
      (e.code === "NOT_FOUND" || e.code === "BAD_REQUEST")
    ) {
      notFound();
    }
    throw e;
  }

  if (request.productId !== productId) notFound();
  const producer = {
    name: request.producerName,
    initials: producerInitials(request.producerName),
    hue: producerHue(request.producerName),
  };

  return (
    <RequestSentScreen
      producer={producer}
      requestRef={request.refNumber}
      studioId={request.producerId}
    />
  );
}
