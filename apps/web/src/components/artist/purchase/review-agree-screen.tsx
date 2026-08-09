"use client";

import type { PaymentPlan, PurchaseCommercialSnapshot } from "@skitza/db";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { ArrowRight, Check, LockIcon, ShieldIcon } from "~/components/artist/funnel/funnel-icons";
import {
  AgreeCheck,
  Eyebrow,
  FunnelTopBar,
  PrimaryCta,
} from "~/components/artist/funnel/funnel-ui";
import { useOnlineStatus } from "~/components/runtime-state/online-required-link";
import type { PaymentPlanChoice } from "~/lib/purchase/request-helpers";
import { withArtistStudio } from "~/lib/artist-studio-context";
import { royaltyTermsDisplay } from "~/lib/purchase/royalty-terms";
import { agreementPdfFromCommercialSnapshot } from "~/lib/agreement-pdf";
import { acceptPurchaseAction } from "./actions";
import { paymentPlanLabel } from "./pay-data";
import {
  formatPurchaseMoney,
  type AgreementTerm,
  type Producer,
  type PurchaseAcceptancePreview,
  type PurchaseProduct,
} from "./purchase-data";

type ExactReviewProps = {
  preview: PurchaseAcceptancePreview;
  studioId?: string | undefined;
  purchaseRequestId: string;
  paymentPlan: PaymentPlanChoice;
  product?: never;
  producer?: never;
  terms?: never;
  previewSentHref?: never;
};

type GalleryReviewProps = {
  product: PurchaseProduct;
  producer: Producer;
  terms: AgreementTerm[];
  previewSentHref: string;
  studioId?: never;
  preview?: never;
  purchaseRequestId?: never;
  paymentPlan?: never;
};

type ReviewAgreeScreenProps = ExactReviewProps | GalleryReviewProps;
type ExistingPurchaseTarget = Extract<PurchaseAcceptancePreview["target"], { kind: "existing" }>;

function isExactReview(props: ReviewAgreeScreenProps): props is ExactReviewProps {
  return props.preview !== undefined;
}

function projectTargetContext(target: ExistingPurchaseTarget): string {
  const lifecycle = target.lifecycleStatus === "active" ? "Active" : "Waiting for payment";
  const stage = target.workflowStage.charAt(0).toUpperCase() + target.workflowStage.slice(1);
  const updated = new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(target.updatedAtIso));
  return `${lifecycle} · ${stage} · Updated ${updated}`;
}

function splitSchedule(totalCents: number, plan: PaymentPlan): number[] {
  const count = plan.kind === "full" ? 1 : plan.kind === "split_50_50" ? 2 : plan.installments;
  const base = Math.floor(totalCents / count);
  const remainder = totalCents - base * count;
  return Array.from({ length: count }, (_, index) => base + (index < remainder ? 1 : 0));
}

// Development-gallery compatibility only. Live routes always receive the
// server-authored preview and cannot use this local representation to accept.
function galleryPreview(props: GalleryReviewProps): PurchaseAcceptancePreview {
  const selectedPaymentPlan = props.product.paymentPlans[0] ?? null;
  const amounts = selectedPaymentPlan
    ? splitSchedule(props.product.priceCents, selectedPaymentPlan)
    : [];
  const snapshot: PurchaseCommercialSnapshot = {
    version: 1,
    productOrOfferName: props.product.name,
    ...(props.product.tagline ? { tagline: props.product.tagline } : {}),
    deliverables: props.product.includes,
    lineItems: [
      {
        label: props.product.name,
        quantity: 1,
        listUnitPriceCents: props.product.priceCents,
        unitPriceCents: props.product.priceCents,
        totalCents: props.product.priceCents,
      },
    ],
    listSubtotalCents: props.product.priceCents,
    discountCents: 0,
    subtotalCents: props.product.priceCents,
    tax: { mode: "tax_free", ratePct: 0, amountCents: 0 },
    totalCents: props.product.priceCents,
    currency: props.product.currency,
    includedSongSpaces: props.product.pricingModel === "per_song" ? 1 : 0,
    session: {
      limit: props.product.unlimitedSessions
        ? { kind: "unlimited" }
        : { kind: "fixed", count: props.product.sessions },
      durationMin: 0,
      locationType: "As agreed",
      bufferMinutes: 0,
      minLeadHours: 0,
    },
    revisionRule: props.product.unlimitedRevisions
      ? { kind: "unlimited" }
      : props.product.revisions > 0
        ? { kind: "fixed", count: props.product.revisions }
        : null,
    royaltyTerms: props.product.royaltyTerms,
    rights: [],
    selectedPaymentPlan,
    offeredPaymentPlans: props.product.paymentPlans,
    agreementText: [
      props.product.agreementText,
      ...props.terms.map((term) => `${term.heading}: ${term.body}`),
    ]
      .filter(Boolean)
      .join("\n\n"),
  };
  return {
    productId: props.product.id,
    productName: props.product.name,
    producerName: props.producer.name,
    status: "approved",
    target: { kind: "new" },
    snapshot,
    snapshotDigest: "development-gallery-preview",
    schedule: amounts.map((amountCents, index) => ({
      label: index === 0 ? "Due at acceptance" : `Payment ${String(index + 1)}`,
      amountCents,
    })),
  };
}

function sessionLines(snapshot: PurchaseCommercialSnapshot): string[] {
  if (!snapshot.session) return ["No sessions included"];
  const session = snapshot.session;
  const limit =
    session.limit.kind === "unlimited"
      ? "Unlimited sessions"
      : `${String(session.limit.count)} ${session.limit.count === 1 ? "session" : "sessions"}`;
  return [
    `${limit} · ${String(session.durationMin)} min each`,
    `Location: ${session.locationType}`,
    `Buffer: ${String(session.bufferMinutes)} min · Minimum notice: ${String(session.minLeadHours)} hours`,
  ];
}

function revisionLabel(snapshot: PurchaseCommercialSnapshot): string {
  if (!snapshot.revisionRule) return "No revision rule listed";
  if (snapshot.revisionRule.kind === "unlimited") return "Unlimited revisions";
  return `${String(snapshot.revisionRule.count)} ${snapshot.revisionRule.count === 1 ? "revision" : "revisions"}`;
}

function taxLabel(snapshot: PurchaseCommercialSnapshot): string {
  if (snapshot.tax.mode === "tax_free") return "Tax free";
  const rate = `${String(snapshot.tax.ratePct)}% tax`;
  return snapshot.tax.mode === "tax_included" ? `${rate} included` : `${rate} added`;
}

export function ReviewAgreeScreen(props: ReviewAgreeScreenProps) {
  const router = useRouter();
  const online = useOnlineStatus();
  const preview: PurchaseAcceptancePreview = isExactReview(props)
    ? props.preview
    : galleryPreview(props);
  const { snapshot } = preview;
  const [accepted, setAccepted] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const operationKeyRef = useRef<string | null>(null);
  const royalty = royaltyTermsDisplay(snapshot.royaltyTerms);
  const agreementPdf = agreementPdfFromCommercialSnapshot(snapshot);
  const selectedPlan = snapshot.selectedPaymentPlan;

  async function acceptExactAgreement() {
    if (!accepted || sending) return;
    if (!isExactReview(props)) {
      router.push(props.previewSentHref);
      return;
    }
    if (!online) {
      setError("Reconnect before accepting. No purchase has been created.");
      return;
    }

    setSending(true);
    setError(null);
    try {
      const operationKey = operationKeyRef.current ?? crypto.randomUUID();
      operationKeyRef.current = operationKey;
      const result = await acceptPurchaseAction({
        purchaseRequestId: props.purchaseRequestId,
        paymentPlan: props.paymentPlan,
        expectedSnapshotDigest: preview.snapshotDigest,
        operationKey,
        agreementAccepted: true,
      });
      if (!result.ok) {
        setSending(false);
        setError(result.error);
        return;
      }
      operationKeyRef.current = null;
      const query = new URLSearchParams({
        purchase: result.purchaseId,
        req: props.purchaseRequestId,
      });
      router.push(
        withArtistStudio(
          `/artist/purchase/${encodeURIComponent(result.productId)}/pay/instructions?${query.toString()}`,
          props.studioId,
        ),
      );
    } catch {
      setSending(false);
      setError("Couldn't accept this agreement. Refresh and try again.");
    }
  }

  const backHref = isExactReview(props)
    ? withArtistStudio(
        `/artist/purchase/${preview.productId}/pay?req=${props.purchaseRequestId}`,
        props.studioId,
      )
    : `/artist/purchase/${preview.productId}`;

  return (
    <div
      className="sk-native-screen fixed inset-x-0 top-[var(--sk-viewport-offset-top,0px)] z-[60] flex flex-col overflow-hidden"
      style={{ background: "rgb(var(--bg-background))" }}
    >
      <div className="relative mx-auto flex min-h-0 w-full max-w-[440px] flex-1 flex-col overflow-hidden">
        <FunnelTopBar
          title="Review exact agreement"
          sub="FINAL ACCEPTANCE"
          onBack={() => {
            router.push(backHref);
          }}
        />

        <main className="sk-native-scroll min-h-0 flex-1 overflow-y-auto px-5 pt-3.5 pb-6">
          <h1 className="reveal-up font-syne text-[26px] leading-[1.1] font-extrabold tracking-[-0.035em] text-[rgb(var(--fg-default))]">
            Accept these exact terms
          </h1>
          <p className="reveal-up reveal-up-delay-1 mt-2 text-[14px] leading-relaxed text-[rgb(var(--fg-muted))]">
            This is the final agreement for {preview.productName} with {preview.producerName}.
            Acceptance freezes every value shown below.
          </p>

          <section
            className="reveal-up reveal-up-delay-1 mt-4 rounded-[var(--radius-lg)] bg-[rgb(var(--bg-sidebar))] px-4 py-4 text-[rgb(var(--fg-onsidebar))]"
            aria-labelledby="purchase-summary-heading"
          >
            <div
              id="purchase-summary-heading"
              className="font-mono text-[9.5px] tracking-[0.14em] text-[rgb(var(--brand-primary))] uppercase"
            >
              Exact purchase
            </div>
            <div className="font-syne mt-1.5 text-[18px] font-extrabold [overflow-wrap:anywhere] break-words text-white">
              {snapshot.productOrOfferName}
            </div>
            {snapshot.tagline ? (
              <p className="mt-1 text-[12.5px] leading-snug text-white/65">{snapshot.tagline}</p>
            ) : null}
            <div className="font-amount mt-3 text-[34px] font-bold tracking-[-0.04em] text-white">
              {formatPurchaseMoney(snapshot.totalCents, snapshot.currency)}
            </div>
            <div className="mt-2 font-mono text-[9px] text-white/50">
              AGREEMENT REF · {preview.snapshotDigest.slice(0, 16)}
            </div>
          </section>

          <section className="reveal-up reveal-up-delay-2 mt-4" aria-labelledby="target-heading">
            <h2 id="target-heading" className="mb-2.5">
              <Eyebrow>Project target</Eyebrow>
            </h2>
            <div className="rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-4 py-3.5">
              <div className="text-[14px] font-bold text-[rgb(var(--fg-default))]">
                {preview.target.kind === "new"
                  ? "Start a new project"
                  : preview.target.projectTitle}
              </div>
              {preview.target.kind === "new" ? (
                <p className="mt-1 text-[12px] leading-snug text-[rgb(var(--fg-muted))]">
                  A new project will be created for this accepted purchase.
                </p>
              ) : (
                <>
                  <p className="mt-1 font-mono text-[10px] leading-relaxed text-[rgb(var(--fg-muted))]">
                    {projectTargetContext(preview.target)}
                  </p>
                  <p className="mt-1.5 text-[12px] leading-snug text-[rgb(var(--fg-muted))]">
                    This purchase will be added to this exact existing project.
                  </p>
                </>
              )}
            </div>
          </section>

          <section className="reveal-up reveal-up-delay-2 mt-4" aria-labelledby="price-heading">
            <h2 id="price-heading" className="mb-2.5">
              <Eyebrow>Quantity & price</Eyebrow>
            </h2>
            <div className="rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-4">
              <ol className="list-none divide-y divide-[rgb(var(--border-subtle))]">
                {snapshot.lineItems.map((item, index) => (
                  <li key={`${item.label}-${String(index)}`} className="py-3.5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-[13.5px] font-semibold [overflow-wrap:anywhere] break-words text-[rgb(var(--fg-default))]">
                          {item.label}
                        </div>
                        <div className="mt-1 text-[11.5px] text-[rgb(var(--fg-muted))]">
                          {String(item.quantity)} ×{" "}
                          {formatPurchaseMoney(item.unitPriceCents, snapshot.currency)}
                          {item.listUnitPriceCents !== item.unitPriceCents ? (
                            <span>
                              {" "}
                              · list{" "}
                              {formatPurchaseMoney(item.listUnitPriceCents, snapshot.currency)} each
                            </span>
                          ) : null}
                        </div>
                      </div>
                      <div className="font-amount shrink-0 text-[13.5px] font-semibold text-[rgb(var(--fg-default))]">
                        {formatPurchaseMoney(item.totalCents, snapshot.currency)}
                      </div>
                    </div>
                  </li>
                ))}
              </ol>
              <dl className="border-t border-[rgb(var(--border-subtle))] py-3 text-[12.5px]">
                {snapshot.listSubtotalCents !== snapshot.subtotalCents ? (
                  <div className="flex justify-between gap-3 py-1 text-[rgb(var(--fg-muted))]">
                    <dt>List subtotal</dt>
                    <dd>{formatPurchaseMoney(snapshot.listSubtotalCents, snapshot.currency)}</dd>
                  </div>
                ) : null}
                {snapshot.discountCents > 0 ? (
                  <div className="flex justify-between gap-3 py-1 text-[rgb(var(--fg-success-text))]">
                    <dt>Volume discount</dt>
                    <dd>−{formatPurchaseMoney(snapshot.discountCents, snapshot.currency)}</dd>
                  </div>
                ) : null}
                <div className="flex justify-between gap-3 py-1 text-[rgb(var(--fg-secondary))]">
                  <dt>Subtotal</dt>
                  <dd>{formatPurchaseMoney(snapshot.subtotalCents, snapshot.currency)}</dd>
                </div>
                <div className="flex justify-between gap-3 py-1 text-[rgb(var(--fg-secondary))]">
                  <dt>{taxLabel(snapshot)}</dt>
                  <dd>{formatPurchaseMoney(snapshot.tax.amountCents, snapshot.currency)}</dd>
                </div>
                <div className="mt-1 flex justify-between gap-3 border-t border-[rgb(var(--border-subtle))] pt-2.5 text-[14px] font-bold text-[rgb(var(--fg-default))]">
                  <dt>Total</dt>
                  <dd>{formatPurchaseMoney(snapshot.totalCents, snapshot.currency)}</dd>
                </div>
              </dl>
            </div>
          </section>

          <section className="reveal-up reveal-up-delay-2 mt-4" aria-labelledby="plan-heading">
            <h2 id="plan-heading" className="mb-2.5">
              <Eyebrow>Selected payment plan</Eyebrow>
            </h2>
            <div className="rounded-[var(--radius-lg)] border border-[rgb(var(--focus-ring))] bg-[rgb(var(--brand-primary)/0.07)] px-4 py-3.5">
              <div className="text-[14px] font-bold text-[rgb(var(--fg-default))]">
                {selectedPlan
                  ? paymentPlanLabel(
                      selectedPlan.kind,
                      selectedPlan.kind === "monthly" ? selectedPlan.installments : null,
                    )
                  : "No payment plan"}
              </div>
              <ol className="mt-2 list-none divide-y divide-[rgb(var(--border-subtle))]">
                {preview.schedule.map((row) => (
                  <li
                    key={row.label}
                    className="flex items-center justify-between gap-3 py-2 text-[12.5px]"
                  >
                    <span className="text-[rgb(var(--fg-secondary))]">{row.label}</span>
                    <span className="font-amount font-semibold text-[rgb(var(--fg-default))]">
                      {formatPurchaseMoney(row.amountCents, snapshot.currency)}
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          </section>

          <section className="reveal-up reveal-up-delay-3 mt-4" aria-labelledby="scope-heading">
            <h2 id="scope-heading" className="mb-2.5">
              <Eyebrow>Scope & rules</Eyebrow>
            </h2>
            <div className="rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-4 py-1">
              <div className="border-b border-[rgb(var(--border-subtle))] py-3">
                <h3 className="text-[12px] font-bold text-[rgb(var(--fg-default))]">
                  Deliverables
                </h3>
                {snapshot.deliverables.length > 0 ? (
                  <ul className="mt-2 list-none space-y-1.5">
                    {snapshot.deliverables.map((item) => (
                      <li
                        key={item}
                        className="flex items-start gap-2 text-[12.5px] text-[rgb(var(--fg-secondary))]"
                      >
                        <Check width={12} height={12} /> <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-1 text-[12.5px] text-[rgb(var(--fg-muted))]">
                    No deliverables listed
                  </p>
                )}
              </div>
              <div className="border-b border-[rgb(var(--border-subtle))] py-3">
                <h3 className="text-[12px] font-bold text-[rgb(var(--fg-default))]">
                  Song spaces & revisions
                </h3>
                <p className="mt-1 text-[12.5px] text-[rgb(var(--fg-secondary))]">
                  {String(snapshot.includedSongSpaces)} included song{" "}
                  {snapshot.includedSongSpaces === 1 ? "space" : "spaces"} ·{" "}
                  {revisionLabel(snapshot)}
                </p>
              </div>
              <div className="py-3">
                <h3 className="text-[12px] font-bold text-[rgb(var(--fg-default))]">
                  Session rules
                </h3>
                <ul className="mt-1 list-none space-y-1 text-[12.5px] text-[rgb(var(--fg-secondary))]">
                  {sessionLines(snapshot).map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              </div>
            </div>
          </section>

          <section className="reveal-up reveal-up-delay-3 mt-4" aria-labelledby="rights-heading">
            <h2 id="rights-heading" className="mb-2.5">
              <Eyebrow>Rights & royalties</Eyebrow>
            </h2>
            <div className="rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-4 py-3.5">
              <dl className="grid gap-2 text-[12.5px]">
                <div className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-3">
                  <dt className="font-semibold text-[rgb(var(--fg-muted))]">Master</dt>
                  <dd className="[overflow-wrap:anywhere] break-words text-[rgb(var(--fg-secondary))]">
                    {royalty.master}
                  </dd>
                </div>
                <div className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-3">
                  <dt className="font-semibold text-[rgb(var(--fg-muted))]">Composition</dt>
                  <dd className="[overflow-wrap:anywhere] break-words text-[rgb(var(--fg-secondary))]">
                    {royalty.composition}
                  </dd>
                </div>
              </dl>
              {snapshot.rights.length > 0 ? (
                <ul className="mt-3 list-none space-y-1.5 border-t border-[rgb(var(--border-subtle))] pt-3">
                  {snapshot.rights.map((right) => (
                    <li
                      key={right}
                      className="text-[12.5px] leading-relaxed text-[rgb(var(--fg-secondary))]"
                    >
                      {right}
                    </li>
                  ))}
                </ul>
              ) : null}
              {snapshot.royaltyTerms?.notes ? (
                <p className="mt-3 border-t border-[rgb(var(--border-subtle))] pt-3 text-[12.5px] leading-relaxed [overflow-wrap:anywhere] break-words whitespace-pre-wrap text-[rgb(var(--fg-secondary))]">
                  {snapshot.royaltyTerms.notes}
                </p>
              ) : null}
            </div>
          </section>

          <section className="reveal-up reveal-up-delay-3 mt-4" aria-labelledby="agreement-heading">
            <h2 id="agreement-heading" className="mb-2.5">
              <Eyebrow>Exact agreement text</Eyebrow>
            </h2>
            <div className="rounded-[var(--radius-lg)] border border-[rgb(var(--border-control))] bg-[rgb(var(--bg-elevated))] px-4 py-4">
              <p className="text-[13px] leading-relaxed [overflow-wrap:anywhere] break-words whitespace-pre-wrap text-[rgb(var(--fg-secondary))]">
                {snapshot.agreementText || "No additional agreement text."}
              </p>
            </div>
            {agreementPdf && isExactReview(props) ? (
              <a
                href={`/api/agreement-pdfs/evidence?purchaseRequestId=${encodeURIComponent(props.purchaseRequestId)}&documentId=${encodeURIComponent(agreementPdf.documentId)}`}
                target="_blank"
                rel="noopener noreferrer"
                referrerPolicy="no-referrer"
                className="sk-press mt-2.5 inline-flex min-h-11 items-center justify-center rounded-[var(--radius-lg)] border border-[rgb(var(--border-control))] px-3.5 text-[12.5px] font-semibold text-[rgb(var(--fg-default))] sm:min-h-9 sm:rounded-[var(--radius-md)]"
              >
                Open PDF agreement · {agreementPdf.originalFileName}
              </a>
            ) : null}
            <div className="mt-2.5 flex items-start gap-1.5 text-[11.5px] leading-snug text-[rgb(var(--fg-muted))]">
              <LockIcon />
              <span>Product edits after acceptance cannot change this purchase snapshot.</span>
            </div>
          </section>

          <div className="reveal-up reveal-up-delay-4 mt-4">
            <AgreeCheck
              checked={accepted}
              onToggle={() => {
                setAccepted((value) => !value);
                setError(null);
              }}
            >
              I accept this exact agreement and payment plan.
            </AgreeCheck>
          </div>
          <div className="mt-2 flex items-start gap-1.5 text-[11.5px] leading-snug text-[rgb(var(--fg-muted))]">
            <ShieldIcon />
            <span>Acceptance creates the immutable purchase and installment schedule.</span>
          </div>

          {error ? (
            <p
              role="alert"
              className="mt-3 rounded-[var(--radius-lg)] bg-[rgb(var(--fg-danger)/0.1)] px-3.5 py-3 text-center text-[12.5px] font-medium text-[rgb(var(--fg-danger-text))]"
            >
              {error}
            </p>
          ) : null}
          {!online && isExactReview(props) ? (
            <p
              role="status"
              className="mt-3 rounded-[var(--radius-lg)] bg-[rgb(var(--bg-sunken))] px-3.5 py-3 text-center text-[12.5px] text-[rgb(var(--fg-secondary))]"
            >
              Reconnect to accept these exact terms.
            </p>
          ) : null}
        </main>

        <div
          className="sk-safe-bottom z-10 shrink-0 px-[18px] pt-3.5 pb-3.5"
          style={{
            background:
              "linear-gradient(180deg, rgb(var(--bg-background) / 0) 0%, rgb(var(--bg-background) / 0.96) 22%)",
          }}
        >
          <PrimaryCta
            onClick={() => {
              void acceptExactAgreement();
            }}
            disabled={!accepted || sending || (!online && isExactReview(props))}
            glow={accepted && !sending && (online || !isExactReview(props))}
            ariaBusy={sending}
            sub={
              !online && isExactReview(props)
                ? "Reconnect for live confirmation"
                : accepted
                  ? "Creates the purchase with these frozen terms"
                  : "Accept the exact agreement to continue"
            }
          >
            {sending ? (
              <>
                <span
                  aria-hidden
                  className="inline-block h-4 w-4 animate-spin rounded-full border-2 motion-reduce:animate-none"
                  style={{
                    borderColor: "rgb(var(--bg-sidebar) / 0.3)",
                    borderTopColor: "rgb(var(--bg-sidebar))",
                  }}
                />{" "}
                Accepting…
              </>
            ) : (
              <>
                Accept exact agreement <ArrowRight />
              </>
            )}
          </PrimaryCta>
        </div>
      </div>
    </div>
  );
}
