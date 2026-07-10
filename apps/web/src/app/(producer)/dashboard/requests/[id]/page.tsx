import { auth } from "@clerk/nextjs/server";
import { TRPCError } from "@trpc/server";
import { notFound, redirect } from "next/navigation";

import {
  PurchaseRequestDetail,
  type PurchaseRequestDetailData,
} from "~/components/dashboard/requests/purchase-request-detail";
import { SetTopBarBreadcrumb } from "~/components/shell/topbar-breadcrumb-context";
import { appRouter } from "~/server/trpc/routers/_app";

export default async function PurchaseRequestDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");
  const { id } = await params;
  const caller = appRouter.createCaller({ userId });

  let detail: PurchaseRequestDetailData;
  try {
    detail = await caller.producer.purchase.get({ id });
  } catch (error) {
    // The API still returns FORBIDDEN to direct callers for a foreign
    // request. The route itself renders a 404 so a guessed URL cannot
    // reveal whether another producer's request exists.
    if (
      error instanceof TRPCError &&
      (error.code === "FORBIDDEN" || error.code === "NOT_FOUND")
    ) {
      notFound();
    }
    throw error;
  }

  return (
    <>
      <SetTopBarBreadcrumb crumbs={[{ label: detail.request.artistName }]} />
      <PurchaseRequestDetail detail={detail} />
    </>
  );
}
