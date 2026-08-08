import { auth } from "@clerk/nextjs/server";
import { TRPCError } from "@trpc/server";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";

import { AcceptedRequestPaymentProofActions } from "~/components/dashboard/requests/accepted-request-payment-proof-actions";
import { PurchaseRequestCommercialDetails } from "~/components/dashboard/requests/purchase-request-commercial-details";
import { PurchaseRequestReview } from "~/components/dashboard/requests/purchase-request-review";
import { SetTopBarBreadcrumb } from "~/components/shell/topbar-breadcrumb-context";
import { formatMoney } from "~/lib/format/money";
import { appRouter } from "~/server/trpc/routers/_app";

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const PURCHASE_REQUEST_ID = z.string().uuid();
const PAYMENT_PROOF_ID = z.string().uuid();

export default async function ProducerPurchaseRequestPage({ params, searchParams }: PageProps) {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const { id } = await params;
  if (!PURCHASE_REQUEST_ID.safeParse(id).success) notFound();

  const query = await searchParams;
  const requestedProofId =
    typeof query.proof === "string" && query.proof.length > 0 ? query.proof : undefined;
  if (requestedProofId && !PAYMENT_PROOF_ID.safeParse(requestedProofId).success) notFound();
  if (requestedProofId) notFound();
  const caller = appRouter.createCaller({ userId });

  let detail: Awaited<ReturnType<typeof caller.producer.purchase.get>>;
  try {
    detail = await caller.producer.purchase.get({ id });
  } catch (error) {
    if (error instanceof TRPCError && (error.code === "FORBIDDEN" || error.code === "NOT_FOUND")) {
      notFound();
    }
    throw error;
  }

  const { request, commercialTerms } = detail;
  const snapshot = commercialTerms.kind === "unavailable" ? null : commercialTerms.snapshot;
  const accepted = commercialTerms.kind === "accepted";
  const productName =
    commercialTerms.kind === "unavailable"
      ? commercialTerms.productName
      : commercialTerms.snapshot.productOrOfferName;
  const pendingProofs =
    commercialTerms.kind === "accepted"
      ? await caller.producer.purchase.proofOfPayment.pending({
          purchaseId: commercialTerms.purchaseId,
        })
      : { available: true as const, proofs: [] };
  const targetProjects = request.targetProjects.map((project) => ({
    ...project,
    updatedAtIso: project.updatedAt.toISOString(),
  }));
  const total = snapshot
    ? formatMoney(snapshot.totalCents, snapshot.currency, {
        withCents: snapshot.totalCents % 100 !== 0,
      })
    : null;
  const submittedAt = new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(request.createdAt);

  return (
    <>
      <SetTopBarBreadcrumb crumbs={[{ label: request.artistName }]} />
      <main className="mx-auto w-full max-w-[1120px] px-4 py-6 sm:px-6 sm:py-10 lg:px-8">
        <Link
          href="/dashboard/requests"
          className="inline-flex min-h-11 items-center text-sm font-medium text-[rgb(var(--fg-muted))] hover:text-[rgb(var(--fg-default))]"
        >
          ← Back to requests
        </Link>

        <PurchaseRequestReview
          key={request.id}
          id={request.id}
          initialStatus={request.status}
          initialProjectId={request.projectId}
          targetProjects={targetProjects}
          canApprove={commercialTerms.kind === "proposal" && commercialTerms.approvalAvailable}
          artistName={request.artistName}
          artistEmail={request.artistEmail}
          productName={productName}
          total={total}
          totalCaption={
            accepted
              ? "Accepted total"
              : snapshot
                ? "Proposal total"
                : "Current proposal unavailable"
          }
          submittedAt={submittedAt}
          reference={request.refNumber}
          brief={request.brief}
        >
          <div className="space-y-7">
            {commercialTerms.kind === "accepted" ? (
              <AcceptedRequestPaymentProofActions proofs={pendingProofs.proofs} />
            ) : null}
            <PurchaseRequestCommercialDetails commercialTerms={commercialTerms} />
          </div>
        </PurchaseRequestReview>
      </main>
    </>
  );
}
