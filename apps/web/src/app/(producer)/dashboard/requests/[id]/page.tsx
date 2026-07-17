import { auth } from "@clerk/nextjs/server";
import { TRPCError } from "@trpc/server";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";

import { planKey, requestPlanLabel } from "~/components/checkout/plan-picker-helpers";
import { PurchaseRequestReview } from "~/components/dashboard/requests/purchase-request-review";
import { SetTopBarBreadcrumb } from "~/components/shell/topbar-breadcrumb-context";
import { safeAgreementUrl } from "~/lib/agreement-url";
import { royaltyTermsDisplay } from "~/lib/purchase/royalty-terms";
import { appRouter } from "~/server/trpc/routers/_app";

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const PURCHASE_REQUEST_ID = z.string().uuid();
const PAYMENT_PROOF_ID = z.string().uuid();

function formatMoney(cents: number, currency: string): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

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

  const { request } = detail;
  const royalty = royaltyTermsDisplay(request.royaltyTermsSnapshot);
  const paymentPlanOptionsSnapshot = request.paymentPlanOptionsSnapshot;
  const agreementUrlSnapshot = safeAgreementUrl(request.contractUrlSnapshot);

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
              {request.status}
            </span>
          </div>
          <h1 className="font-display mt-3 text-[clamp(1.75rem,4vw,2.5rem)] leading-tight font-extrabold tracking-[-0.035em] [overflow-wrap:anywhere] break-words text-[rgb(var(--fg-default))]">
            {request.productNameSnapshot}
          </h1>
          <p className="mt-2 text-sm text-[rgb(var(--fg-secondary))]">
            Requested by {request.artistName} · {request.artistEmail}
          </p>
          <p className="font-display mt-4 text-2xl font-extrabold text-[rgb(var(--fg-default))] tabular-nums">
            {formatMoney(request.priceCents, request.currency)}
          </p>
        </header>

        <PurchaseRequestReview
          key={request.id}
          id={request.id}
          initialStatus={request.status}
          initialUndoableUntilIso={request.undoableUntil?.toISOString() ?? null}
        />

        <div className="divide-y divide-[rgb(var(--border-subtle))]">
          <section className="py-6" aria-labelledby="request-payment-heading">
            <h2
              id="request-payment-heading"
              className="font-display text-lg font-bold text-[rgb(var(--fg-default))]"
            >
              Proposed payment choices
            </h2>
            <ul className="mt-3 list-none space-y-2">
              {paymentPlanOptionsSnapshot.map((plan) => (
                <li
                  key={planKey(plan)}
                  className="text-sm leading-relaxed text-[rgb(var(--fg-secondary))]"
                >
                  {requestPlanLabel(plan, request.priceCents, (cents) =>
                    formatMoney(cents, request.currency),
                  )}
                </li>
              ))}
            </ul>
            <p className="mt-3 text-xs text-[rgb(var(--fg-muted))]">
              {request.paymentPlanChosenAt && request.paymentPlanSnapshot
                ? `Artist selection: ${requestPlanLabel(
                    request.paymentPlanSnapshot,
                    request.priceCents,
                    (cents) => formatMoney(cents, request.currency),
                  )}`
                : request.priceCents === 0
                  ? "No payment plan is needed for this zero-total proposal."
                  : "Not chosen yet — final plan selection happens at acceptance."}
            </p>
          </section>

          <section className="py-6" aria-labelledby="request-rights-heading">
            <h2
              id="request-rights-heading"
              className="font-display text-lg font-bold text-[rgb(var(--fg-default))]"
            >
              Rights &amp; royalties
            </h2>
            <dl className="mt-3 grid gap-3 text-sm">
              <div className="grid min-w-0 grid-cols-[6rem_minmax(0,1fr)] gap-3">
                <dt className="font-medium text-[rgb(var(--fg-muted))]">Master</dt>
                <dd className="min-w-0 [overflow-wrap:anywhere] break-words text-[rgb(var(--fg-secondary))]">
                  {royalty.master}
                </dd>
              </div>
              <div className="grid min-w-0 grid-cols-[6rem_minmax(0,1fr)] gap-3">
                <dt className="font-medium text-[rgb(var(--fg-muted))]">Composition</dt>
                <dd className="min-w-0 [overflow-wrap:anywhere] break-words text-[rgb(var(--fg-secondary))]">
                  {royalty.composition}
                </dd>
              </div>
            </dl>
            {request.royaltyTermsSnapshot?.notes ? (
              <p className="mt-4 text-sm leading-relaxed [overflow-wrap:anywhere] break-words whitespace-pre-wrap text-[rgb(var(--fg-secondary))]">
                {request.royaltyTermsSnapshot.notes}
              </p>
            ) : null}
          </section>

          <section className="py-6" aria-labelledby="request-agreement-heading">
            <h2
              id="request-agreement-heading"
              className="font-display text-lg font-bold text-[rgb(var(--fg-default))]"
            >
              Proposed agreement
            </h2>
            {request.agreementTextSnapshot ? (
              <p className="mt-3 text-sm leading-relaxed [overflow-wrap:anywhere] break-words whitespace-pre-wrap text-[rgb(var(--fg-secondary))]">
                {request.agreementTextSnapshot}
              </p>
            ) : (
              <p className="mt-3 text-sm text-[rgb(var(--fg-muted))]">No inline agreement text.</p>
            )}
            {agreementUrlSnapshot ? (
              <a
                href={agreementUrlSnapshot}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-4 inline-flex min-h-11 items-center rounded-[var(--radius-lg)] bg-[rgb(var(--bg-sidebar))] px-4 text-sm font-semibold text-[rgb(var(--brand-primary))]"
              >
                Open proposed agreement link
              </a>
            ) : null}
            <p className="mt-4 text-xs text-[rgb(var(--fg-muted))]">
              Final acceptance is recorded on the purchase, not this request.
            </p>
          </section>
        </div>
      </main>
    </>
  );
}
