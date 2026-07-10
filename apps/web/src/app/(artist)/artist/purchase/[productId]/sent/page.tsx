import { auth } from "@clerk/nextjs/server";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { TRPCError } from "@trpc/server";

import { RequestSentScreen } from "~/components/artist/purchase/request-sent-screen";
import { toProducer, toPurchaseProduct } from "~/lib/purchase/product-mapping";
import { appRouter } from "~/server/trpc/routers/_app";

type PageProps = {
  params: Promise<{ productId: string }>;
  searchParams: Promise<{ req?: string }>;
};

export const metadata: Metadata = { title: "Request sent" };

// S5 — Request sent (Commit). Real BE-1 data (SK-46): the request id comes
// back from `requestToBookAction` as `?req=`; we read the row with
// `artist.purchase.get` and show the server-issued ref + the price that
// locked at request time. No `?req=` (deep link / stale refresh) falls back
// to the S3 entry screen.
export default async function PurchaseSentPage({ params, searchParams }: PageProps) {
  const { userId } = await auth();
  if (!userId) return null;

  const { productId } = await params;
  const { req } = await searchParams;
  if (!req) redirect(`/artist/purchase/${productId}`);

  const caller = appRouter.createCaller({ userId });

  let request: Awaited<ReturnType<typeof caller.artist.purchase.get>>;
  let row: Awaited<ReturnType<typeof caller.artist.store.product>>;
  try {
    [request, row] = await Promise.all([
      caller.artist.purchase.get({ purchaseRequestId: req }),
      caller.artist.store.product({ productId }),
    ]);
  } catch (e) {
    if (
      e instanceof TRPCError &&
      (e.code === "NOT_FOUND" || e.code === "BAD_REQUEST")
    ) {
      notFound();
    }
    throw e;
  }

  // Name + price come from the REQUEST snapshot — that's the locked truth
  // even if the producer edits the product a minute later.
  const product = {
    ...toPurchaseProduct(row),
    name: request.productNameSnapshot,
    priceCents: request.priceCents,
  };

  return (
    <RequestSentScreen
      product={product}
      producer={toProducer(row)}
      requestRef={request.refNumber}
    />
  );
}
