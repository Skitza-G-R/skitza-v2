"use client";

import type { PurchaseCommercialSnapshot } from "@skitza/db";
import { ChevronDown, MessageCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";

import { cancelPrivateOfferAction } from "~/app/(producer)/dashboard/store/private-offer-actions";
import { useOnlineStatus } from "~/components/runtime-state/online-required-link";
import { useToast } from "~/components/ui/toast";
import type { TaxMode } from "~/lib/tax-mode";
import { agreementPdfFromCommercialSnapshot } from "~/lib/agreement-pdf";
import type { PrivateOfferInput } from "~/server/domain/private-offers/service";
import {
  PrivateOfferComposer,
  type PrivateOfferComposerRecipient,
  type PrivateOfferCurrency,
  type PrivateOfferSentSummary,
} from "./private-offer-composer";
import {
  PRIVATE_OFFER_HISTORY_PAGE_SIZE,
  partitionProducerPrivateOffers,
  privateOfferExpiryUrgency,
} from "./private-offer-list-model";
import { PrivateOfferShareModal, type PrivateOfferShareDetails } from "./private-offer-share";

export type ProducerPrivateOfferItem = Readonly<{
  id: string;
  status: "draft" | "sent" | "accepted" | "declined" | "expired" | "canceled";
  commercialDraft: PurchaseCommercialSnapshot;
  expiresAt: Date;
  acceptedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  clientContactId: string;
  recipientName: string;
  recipientEmail: string;
  targetProjectId: string | null;
  targetProjectTitle: string | null;
  productId?: string | null;
  sourceProductName?: string | null;
  purchaseId: string | null;
  purchaseLifecycleStatus: "waiting_for_payment" | "active" | "canceled" | null;
}>;

function snapshotToInput(snapshot: PurchaseCommercialSnapshot): PrivateOfferInput {
  return {
    name: snapshot.productOrOfferName,
    ...(snapshot.tagline ? { tagline: snapshot.tagline } : {}),
    service: snapshot.service ?? "Custom service",
    deliverables: [...snapshot.deliverables],
    cashPriceCents: snapshot.subtotalCents,
    currency: snapshot.currency,
    taxMode: snapshot.tax.mode,
    taxRatePct: snapshot.tax.ratePct,
    includedSongSpaces: snapshot.includedSongSpaces,
    session:
      snapshot.session === null
        ? null
        : { ...snapshot.session, limit: { ...snapshot.session.limit } },
    revisionRule: snapshot.revisionRule === null ? null : { ...snapshot.revisionRule },
    royaltyTerms:
      snapshot.royaltyTerms === null
        ? null
        : {
            ...snapshot.royaltyTerms,
            master: { ...snapshot.royaltyTerms.master },
            composition: { ...snapshot.royaltyTerms.composition },
          },
    rights: [...snapshot.rights],
    enabledPaymentPlans: snapshot.offeredPaymentPlans.map((plan) => ({ ...plan })),
    agreementMode:
      snapshot.agreementMode ??
      (snapshot.agreementPdf ? "pdf" : snapshot.agreementText ? "text" : "none"),
    agreementText: snapshot.agreementText,
  };
}

function money(snapshot: PurchaseCommercialSnapshot): string {
  try {
    return new Intl.NumberFormat("en", {
      style: "currency",
      currency: snapshot.currency,
      maximumFractionDigits: 2,
    }).format(snapshot.totalCents / 100);
  } catch {
    return `${snapshot.currency} ${(snapshot.totalCents / 100).toFixed(2)}`;
  }
}

function shortDate(value: Date): string {
  return value.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

const STATUS_LABEL: Record<ProducerPrivateOfferItem["status"], string> = {
  draft: "Draft",
  sent: "Waiting for artist",
  accepted: "Accepted",
  declined: "Rejected",
  expired: "Expired",
  canceled: "Canceled",
};

const CHIP_BASE =
  "rounded-[var(--radius-sm)] px-2 py-1 font-mono text-[9px] font-bold tracking-[0.08em] uppercase";

function statusChipClass(status: ProducerPrivateOfferItem["status"]): string {
  if (status === "accepted") return `${CHIP_BASE} pill-success`;
  if (status === "declined") return `${CHIP_BASE} pill-danger`;
  return `${CHIP_BASE} bg-[rgb(var(--bg-sunken))] text-[rgb(var(--fg-muted))]`;
}

function ExpiryNote({ expiresAt, now }: { expiresAt: Date; now: Date }) {
  const urgency = privateOfferExpiryUrgency(expiresAt, now);
  if (urgency.kind === "expired") {
    return <span className="font-semibold text-[rgb(var(--fg-danger-text))]">Expired</span>;
  }
  if (urgency.kind === "days-left") {
    return (
      <span
        className={
          urgency.tone === "danger"
            ? "font-semibold text-[rgb(var(--fg-danger-text))]"
            : "font-semibold text-[rgb(var(--fg-warning-text))]"
        }
      >
        Expires in {urgency.days} {urgency.days === 1 ? "day" : "days"}
      </span>
    );
  }
  return <span>Expires {shortDate(expiresAt)}</span>;
}

function shareDetailsFor(offer: ProducerPrivateOfferItem): PrivateOfferShareDetails {
  return {
    offerId: offer.id,
    offerName: offer.commercialDraft.productOrOfferName,
    recipientName: offer.recipientName,
    recipientEmail: offer.recipientEmail,
  };
}

export function PrivateOfferManager({
  recipients,
  offers,
  defaultCurrency,
  taxMode,
  taxRatePct,
  producerSlug,
  lockedClientId,
  showHistory = true,
}: {
  recipients: PrivateOfferComposerRecipient[];
  offers: ProducerPrivateOfferItem[];
  defaultCurrency: PrivateOfferCurrency;
  taxMode: TaxMode;
  taxRatePct: number;
  producerSlug: string;
  lockedClientId?: string;
  showHistory?: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const online = useOnlineStatus();
  const [pending, startTransition] = useTransition();
  const [cancelingId, setCancelingId] = useState<string | null>(null);
  const [share, setShare] = useState<Readonly<{
    details: PrivateOfferShareDetails;
    occasion: "sent" | "reshare";
  }> | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyVisible, setHistoryVisible] = useState(PRIVATE_OFFER_HISTORY_PAGE_SIZE);
  const shareReturnFocusRef = useRef<HTMLElement | null>(null);
  const visibleOffers = lockedClientId
    ? offers.filter((offer) => offer.clientContactId === lockedClientId)
    : offers;
  const { open: openOffers, history: historyOffers } =
    partitionProducerPrivateOffers(visibleOffers);
  const now = new Date();

  function handleSent(sent: PrivateOfferSentSummary) {
    shareReturnFocusRef.current = null;
    setShare({
      details: {
        offerId: sent.offerId,
        offerName: sent.offerName,
        recipientName: sent.recipientName,
        recipientEmail: sent.recipientEmail,
        emailDelivered: sent.emailDelivered,
      },
      occasion: "sent",
    });
    router.refresh();
  }

  function cancelOffer(offer: ProducerPrivateOfferItem) {
    if (!online) {
      toast("Reconnect to cancel this private offer.", "error");
      return;
    }
    if (!window.confirm("Cancel this private offer? The artist will no longer see it.")) {
      return;
    }
    setCancelingId(offer.id);
    startTransition(async () => {
      try {
        const result = await cancelPrivateOfferAction(offer.id);
        if (!result.ok) {
          toast(result.error, "error");
        } else {
          toast("Private offer canceled.", "success");
          router.refresh();
        }
      } catch {
        toast("Could not cancel this private offer. Try again.", "error");
      } finally {
        setCancelingId(null);
      }
    });
  }

  function renderOpenOffer(offer: ProducerPrivateOfferItem) {
    return (
      <li
        key={offer.id}
        className="min-w-0 rounded-[var(--radius-lg)] border bg-[rgb(var(--bg-elevated))] p-4"
        style={{ borderColor: "rgb(var(--border-subtle))" }}
      >
        <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-display min-w-0 text-sm font-extrabold break-words text-[rgb(var(--fg-default))]">
                {offer.commercialDraft.productOrOfferName}
              </p>
              <span className={statusChipClass(offer.status)}>{STATUS_LABEL[offer.status]}</span>
            </div>
            <p className="mt-1 text-xs break-words text-[rgb(var(--fg-muted))]">
              {offer.recipientName} · {offer.recipientEmail}
            </p>
            <p className="mt-1 font-mono text-[10px] text-[rgb(var(--fg-muted))]">
              {offer.targetProjectTitle ?? "New project"} ·{" "}
              <ExpiryNote expiresAt={offer.expiresAt} now={now} />
            </p>
          </div>
          <div className="flex min-w-0 flex-wrap items-center gap-2 sm:justify-end">
            <span className="mr-1 font-mono text-sm font-bold text-[rgb(var(--fg-default))]">
              {money(offer.commercialDraft)}
            </span>
            {offer.status === "sent" ? (
              <>
                <button
                  type="button"
                  onClick={(event) => {
                    shareReturnFocusRef.current = event.currentTarget;
                    setShare({ details: shareDetailsFor(offer), occasion: "reshare" });
                  }}
                  className="sk-press inline-flex min-h-11 items-center gap-1.5 rounded-[var(--radius-lg)] border px-3 text-xs font-semibold text-[rgb(var(--fg-default))]"
                  style={{ borderColor: "rgb(var(--border-subtle))" }}
                >
                  <MessageCircle size={14} strokeWidth={2.2} aria-hidden />
                  Share
                </button>
                <PrivateOfferComposer
                  recipients={recipients}
                  defaultCurrency={defaultCurrency}
                  taxMode={taxMode}
                  taxRatePct={taxRatePct}
                  initialOffer={{
                    id: offer.id,
                    clientContactId: offer.clientContactId,
                    targetProjectId: offer.targetProjectId,
                    terms: snapshotToInput(offer.commercialDraft),
                    expiresAt: offer.expiresAt.toISOString(),
                    expectedUpdatedAt: offer.updatedAt.toISOString(),
                    recipientName: offer.recipientName,
                    recipientEmail: offer.recipientEmail,
                    productId: offer.productId ?? null,
                    sourceProductName: offer.sourceProductName ?? null,
                    agreementPdf: (() => {
                      const pdf = agreementPdfFromCommercialSnapshot(offer.commercialDraft);
                      return pdf
                        ? {
                            documentId: pdf.documentId,
                            originalFileName: pdf.originalFileName,
                            sizeBytes: pdf.sizeBytes,
                          }
                        : null;
                    })(),
                  }}
                />
                <button
                  type="button"
                  disabled={pending && cancelingId === offer.id}
                  onClick={() => {
                    cancelOffer(offer);
                  }}
                  className="min-h-11 rounded-[var(--radius-lg)] border px-3 text-xs font-semibold text-[rgb(var(--fg-muted))] disabled:opacity-50"
                  style={{ borderColor: "rgb(var(--border-subtle))" }}
                >
                  {pending && cancelingId === offer.id ? "Canceling…" : "Cancel offer"}
                </button>
              </>
            ) : null}
          </div>
        </div>
      </li>
    );
  }

  function renderHistoryOffer(offer: ProducerPrivateOfferItem) {
    return (
      <li
        key={offer.id}
        className="min-w-0 rounded-[var(--radius-lg)] border bg-[rgb(var(--bg-elevated))] p-4"
        style={{ borderColor: "rgb(var(--border-subtle))" }}
      >
        <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-display min-w-0 text-sm font-extrabold break-words text-[rgb(var(--fg-default))]">
                {offer.commercialDraft.productOrOfferName}
              </p>
              <span className={statusChipClass(offer.status)}>{STATUS_LABEL[offer.status]}</span>
            </div>
            <p className="mt-1 text-xs break-words text-[rgb(var(--fg-muted))]">
              {offer.recipientName} · {offer.recipientEmail}
            </p>
            <p className="mt-1 font-mono text-[10px] text-[rgb(var(--fg-muted))]">
              {offer.targetProjectTitle ?? "New project"} ·{" "}
              {offer.status === "accepted" && offer.acceptedAt
                ? `Accepted ${shortDate(offer.acceptedAt)}`
                : `Sent ${shortDate(offer.createdAt)}`}
            </p>
          </div>
          <span className="font-mono text-sm font-bold text-[rgb(var(--fg-default))]">
            {money(offer.commercialDraft)}
          </span>
        </div>
      </li>
    );
  }

  return (
    <section aria-labelledby="producer-private-offers-heading" className="min-w-0">
      <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <p className="font-mono text-[10px] font-bold tracking-[0.14em] text-[rgb(var(--fg-muted))] uppercase">
            Private sales
          </p>
          <h2
            id="producer-private-offers-heading"
            className="font-display text-xl font-extrabold text-[rgb(var(--fg-default))]"
          >
            Private offers
          </h2>
          <p className="mt-1 max-w-[62ch] text-xs leading-relaxed text-[rgb(var(--fg-muted))]">
            Terms stay inside the invited artist’s verified account. Share the link on WhatsApp or
            let the email notification do it.
          </p>
        </div>
        <PrivateOfferComposer
          recipients={recipients}
          {...(lockedClientId ? { lockedClientId } : {})}
          defaultCurrency={defaultCurrency}
          taxMode={taxMode}
          taxRatePct={taxRatePct}
          onCreated={handleSent}
        />
      </div>

      {showHistory ? (
        <>
          {openOffers.length === 0 ? (
            <div
              className="mt-4 rounded-[var(--radius-lg)] border border-dashed p-5 text-sm text-[rgb(var(--fg-muted))]"
              style={{ borderColor: "rgb(var(--border-subtle))" }}
            >
              {historyOffers.length === 0
                ? "No private offers yet."
                : "No offers waiting on an artist right now."}
            </div>
          ) : (
            <>
              <p className="mt-5 font-mono text-[10px] font-bold tracking-[0.14em] text-[rgb(var(--fg-muted))] uppercase">
                Waiting for artist · {openOffers.length}
              </p>
              <ul className="mt-2 space-y-2">{openOffers.map(renderOpenOffer)}</ul>
            </>
          )}

          {historyOffers.length > 0 ? (
            <div className="mt-6">
              <button
                type="button"
                aria-expanded={historyOpen}
                aria-controls="private-offer-history"
                onClick={() => {
                  setHistoryOpen((current) => {
                    if (current) setHistoryVisible(PRIVATE_OFFER_HISTORY_PAGE_SIZE);
                    return !current;
                  });
                }}
                className="sk-press flex min-h-11 w-full items-center justify-between rounded-[var(--radius-lg)] border px-4 text-[13px] font-semibold text-[rgb(var(--fg-default))]"
                style={{ borderColor: "rgb(var(--border-subtle))" }}
              >
                <span>
                  History{" "}
                  <span className="font-mono text-[10px] font-bold text-[rgb(var(--fg-muted))]">
                    · {historyOffers.length}
                  </span>
                </span>
                <ChevronDown
                  size={16}
                  strokeWidth={2.2}
                  aria-hidden
                  className={`transition-transform motion-reduce:transition-none ${historyOpen ? "rotate-180" : ""}`}
                />
              </button>
              {historyOpen ? (
                <div id="private-offer-history">
                  <ul className="mt-2 space-y-2">
                    {historyOffers.slice(0, historyVisible).map(renderHistoryOffer)}
                  </ul>
                  {historyOffers.length > historyVisible ? (
                    <button
                      type="button"
                      onClick={() => {
                        setHistoryVisible((current) => current + PRIVATE_OFFER_HISTORY_PAGE_SIZE);
                      }}
                      className="sk-press mt-2 inline-flex min-h-11 w-full items-center justify-center rounded-[var(--radius-lg)] border px-3 text-xs font-semibold text-[rgb(var(--fg-muted))]"
                      style={{ borderColor: "rgb(var(--border-subtle))" }}
                    >
                      Show{" "}
                      {Math.min(
                        PRIVATE_OFFER_HISTORY_PAGE_SIZE,
                        historyOffers.length - historyVisible,
                      )}{" "}
                      more
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}
        </>
      ) : null}

      <PrivateOfferShareModal
        open={share !== null}
        onClose={() => {
          setShare(null);
        }}
        offer={share?.details ?? null}
        producerSlug={producerSlug}
        occasion={share?.occasion ?? "reshare"}
        returnFocusRef={shareReturnFocusRef}
      />
    </section>
  );
}
