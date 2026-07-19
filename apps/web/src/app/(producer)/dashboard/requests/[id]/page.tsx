import { auth } from "@clerk/nextjs/server";
import { TRPCError } from "@trpc/server";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";

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

  return (
    <>
      <SetTopBarBreadcrumb crumbs={[{ label: request.artistName }]} />
      <main className="mx-auto w-full max-w-[720px] px-4 py-6 sm:px-6 sm:py-10">
        <Link
          href="/dashboard/requests"
          className="inline-flex min-h-11 items-center text-sm font-medium text-[rgb(var(--fg-muted))] hover:text-[rgb(var(--fg-default))]"
        >
          ← Back to requests
        </Link>

        <header className="mt-4 border-b border-[rgb(var(--border-subtle))] pb-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="font-mono text-[11px] font-semibold tracking-[0.14em] text-[rgb(var(--fg-muted))] uppercase">
              {request.refNumber}
            </p>
            <span className="rounded-[var(--radius-sm)] bg-[rgb(var(--bg-sunken))] px-2.5 py-1 text-xs font-semibold text-[rgb(var(--fg-secondary))] capitalize">
              {accepted ? "Accepted" : request.status}
            </span>
          </div>
          <h1 className="font-display mt-3 text-[clamp(1.75rem,4vw,2.5rem)] leading-tight font-extrabold tracking-[-0.035em] [overflow-wrap:anywhere] break-words text-[rgb(var(--fg-default))]">
            {productName}
          </h1>
          <p className="mt-2 text-sm text-[rgb(var(--fg-secondary))]">
            Requested by {request.artistName} · {request.artistEmail}
          </p>
          {snapshot ? (
            <p className="font-display mt-4 text-2xl font-extrabold text-[rgb(var(--fg-default))] tabular-nums">
              {formatMoney(snapshot.totalCents, snapshot.currency, {
                withCents: snapshot.totalCents % 100 !== 0,
              })}
            </p>
          ) : null}
          <p className="mt-1 text-xs text-[rgb(var(--fg-muted))]">
            {accepted
              ? "Authoritative accepted total"
              : snapshot
                ? "Current proposal total"
                : "Current proposal unavailable"}
          </p>
        </header>

        {commercialTerms.kind !== "accepted" && request.status !== "converted" ? (
          <PurchaseRequestReview
            key={request.id}
            id={request.id}
            initialStatus={request.status}
            initialUndoableUntilIso={request.undoableUntil?.toISOString() ?? null}
            initialProjectId={request.projectId}
            targetProjects={request.targetProjects.map((project) => ({
              ...project,
              updatedAtIso: project.updatedAt.toISOString(),
            }))}
            canApprove={
              commercialTerms.kind === "proposal" && commercialTerms.approvalAvailable
            }
          />
        ) : null}

        {commercialTerms.kind === "accepted" ? (
          <p className="border-b border-[rgb(var(--border-subtle))] py-5 text-sm leading-relaxed text-[rgb(var(--fg-secondary))]">
            The artist accepted these terms. Any later payment follow-up belongs in Payments.
          </p>
        ) : null}

        <PurchaseRequestCommercialDetails
          commercialTerms={commercialTerms}
          brief={request.brief}
          submittedAt={request.createdAt}
        />
      </main>
    </>
  );
}
