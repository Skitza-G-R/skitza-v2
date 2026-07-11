import { auth } from "@clerk/nextjs/server";
import { TRPCError } from "@trpc/server";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import {
  planKey,
  requestPlanLabel,
} from "~/components/checkout/plan-picker-helpers";
import { safeAgreementUrl } from "~/lib/agreement-url";
import { royaltyTermsDisplay } from "~/lib/purchase/royalty-terms";
import { appRouter } from "~/server/trpc/routers/_app";

type PageProps = { params: Promise<{ id: string }> };

function formatMoney(cents: number, currency: string): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

export default async function ProducerPurchaseRequestPage({ params }: PageProps) {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const { id } = await params;
  const caller = appRouter.createCaller({ userId });
  let request: Awaited<ReturnType<typeof caller.producer.purchase.get>>;
  try {
    request = await caller.producer.purchase.get({ id });
  } catch (error) {
    if (error instanceof TRPCError && error.code === "NOT_FOUND") notFound();
    throw error;
  }

  const royalty = royaltyTermsDisplay(request.royaltyTermsSnapshot);
  const paymentPlanOptionsSnapshot = request.paymentPlanOptionsSnapshot;
  const agreementUrlSnapshot = safeAgreementUrl(request.contractUrlSnapshot);

  return (
    <main className="mx-auto w-full max-w-[720px] px-4 py-6 sm:px-6 sm:py-10">
      <Link
        href="/dashboard"
        className="inline-flex min-h-11 items-center text-sm font-medium text-[rgb(var(--fg-muted))] hover:text-[rgb(var(--fg-default))]"
      >
        ← Back to dashboard
      </Link>

      <header className="mt-4 border-b border-[rgb(var(--border-subtle))] pb-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-[rgb(var(--fg-muted))]">
            {request.refNumber}
          </p>
          <span className="rounded-[var(--radius-sm)] bg-[rgb(var(--bg-sunken))] px-2.5 py-1 text-xs font-semibold capitalize text-[rgb(var(--fg-secondary))]">
            {request.status}
          </span>
        </div>
        <h1 className="mt-3 break-words font-display text-[clamp(1.75rem,4vw,2.5rem)] font-extrabold leading-tight tracking-[-0.035em] text-[rgb(var(--fg-default))] [overflow-wrap:anywhere]">
          {request.productNameSnapshot}
        </h1>
        <p className="mt-2 text-sm text-[rgb(var(--fg-secondary))]">
          Requested by {request.artistName} · {request.artistEmail}
        </p>
        <p className="mt-4 font-display text-2xl font-extrabold tabular-nums text-[rgb(var(--fg-default))]">
          {formatMoney(request.priceCents, request.currency)}
        </p>
      </header>

      <div className="divide-y divide-[rgb(var(--border-subtle))]">
        <section className="py-6" aria-labelledby="request-payment-heading">
          <h2 id="request-payment-heading" className="font-display text-lg font-bold text-[rgb(var(--fg-default))]">
            Frozen payment choices
          </h2>
          <ul className="mt-3 list-none space-y-2">
            {paymentPlanOptionsSnapshot.map((plan) => (
              <li key={planKey(plan)} className="text-sm leading-relaxed text-[rgb(var(--fg-secondary))]">
                {requestPlanLabel(plan, request.priceCents, (cents) =>
                  formatMoney(cents, request.currency),
                )}
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-[rgb(var(--fg-muted))]">
            {request.paymentPlanChosenAt
              ? `Artist selection: ${requestPlanLabel(
                  request.paymentPlanSnapshot,
                  request.priceCents,
                  (cents) => formatMoney(cents, request.currency),
                )}`
              : "Not chosen yet — the artist picks after approval."}
          </p>
        </section>

        <section className="py-6" aria-labelledby="request-rights-heading">
          <h2 id="request-rights-heading" className="font-display text-lg font-bold text-[rgb(var(--fg-default))]">
            Rights & royalties
          </h2>
          <dl className="mt-3 grid gap-3 text-sm">
            <div className="grid min-w-0 grid-cols-[6rem_minmax(0,1fr)] gap-3">
              <dt className="font-medium text-[rgb(var(--fg-muted))]">Master</dt>
              <dd className="min-w-0 break-words text-[rgb(var(--fg-secondary))] [overflow-wrap:anywhere]">{royalty.master}</dd>
            </div>
            <div className="grid min-w-0 grid-cols-[6rem_minmax(0,1fr)] gap-3">
              <dt className="font-medium text-[rgb(var(--fg-muted))]">Composition</dt>
              <dd className="min-w-0 break-words text-[rgb(var(--fg-secondary))] [overflow-wrap:anywhere]">
                {royalty.composition}
              </dd>
            </div>
          </dl>
          {request.royaltyTermsSnapshot?.notes ? (
            <p className="mt-4 whitespace-pre-wrap break-words text-sm leading-relaxed text-[rgb(var(--fg-secondary))] [overflow-wrap:anywhere]">
              {request.royaltyTermsSnapshot.notes}
            </p>
          ) : null}
        </section>

        <section className="py-6" aria-labelledby="request-agreement-heading">
          <h2 id="request-agreement-heading" className="font-display text-lg font-bold text-[rgb(var(--fg-default))]">
            Agreement snapshot
          </h2>
          {request.agreementTextSnapshot ? (
            <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-relaxed text-[rgb(var(--fg-secondary))] [overflow-wrap:anywhere]">
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
              Open accepted agreement link
            </a>
          ) : null}
          <p className="mt-4 text-xs text-[rgb(var(--fg-muted))]">
            {request.acceptedAt
              ? `Accepted ${request.acceptedAt.toLocaleString("en-US")}`
              : "Acceptance timestamp unavailable"}
          </p>
        </section>
      </div>
    </main>
  );
}
