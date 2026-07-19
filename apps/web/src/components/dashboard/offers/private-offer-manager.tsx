"use client";

import type { PurchaseCommercialSnapshot } from "@skitza/db";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { cancelPrivateOfferAction } from "~/app/(producer)/dashboard/store/private-offer-actions";
import { useToast } from "~/components/ui/toast";
import type { TaxMode } from "~/lib/tax-mode";
import type { PrivateOfferInput } from "~/server/domain/private-offers/service";
import {
  PrivateOfferComposer,
  type PrivateOfferComposerRecipient,
  type PrivateOfferCurrency,
} from "./private-offer-composer";

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

const STATUS_LABEL: Record<ProducerPrivateOfferItem["status"], string> = {
  draft: "Draft",
  sent: "Waiting for artist",
  accepted: "Accepted",
  declined: "Rejected",
  expired: "Expired",
  canceled: "Canceled",
};

export function PrivateOfferManager({
  recipients,
  offers,
  defaultCurrency,
  taxMode,
  taxRatePct,
  lockedClientId,
  showHistory = true,
}: {
  recipients: PrivateOfferComposerRecipient[];
  offers: ProducerPrivateOfferItem[];
  defaultCurrency: PrivateOfferCurrency;
  taxMode: TaxMode;
  taxRatePct: number;
  lockedClientId?: string;
  showHistory?: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [cancelingId, setCancelingId] = useState<string | null>(null);
  const visibleOffers = lockedClientId
    ? offers.filter((offer) => offer.clientContactId === lockedClientId)
    : offers;

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
            Terms stay inside the invited artist’s verified account. Email is only a notification.
          </p>
        </div>
        <PrivateOfferComposer
          recipients={recipients}
          {...(lockedClientId ? { lockedClientId } : {})}
          defaultCurrency={defaultCurrency}
          taxMode={taxMode}
          taxRatePct={taxRatePct}
        />
      </div>

      {showHistory ? (
        visibleOffers.length === 0 ? (
          <div
            className="mt-4 rounded-[var(--radius-lg)] border border-dashed p-5 text-sm text-[rgb(var(--fg-muted))]"
            style={{ borderColor: "rgb(var(--border-subtle))" }}
          >
            No private offers yet.
          </div>
        ) : (
          <ul className="mt-4 space-y-2">
            {visibleOffers.map((offer) => (
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
                      <span className="rounded-[var(--radius-sm)] bg-[rgb(var(--bg-sunken))] px-2 py-1 font-mono text-[9px] font-bold tracking-[0.08em] text-[rgb(var(--fg-muted))] uppercase">
                        {STATUS_LABEL[offer.status]}
                      </span>
                    </div>
                    <p className="mt-1 text-xs break-words text-[rgb(var(--fg-muted))]">
                      {offer.recipientName} · {offer.recipientEmail}
                    </p>
                    <p className="mt-1 font-mono text-[10px] text-[rgb(var(--fg-muted))]">
                      {offer.targetProjectTitle ?? "New project"} · Expires{" "}
                      {offer.expiresAt.toLocaleDateString("en-GB", {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                        timeZone: "UTC",
                      })}
                    </p>
                  </div>
                  <div className="flex min-w-0 flex-wrap items-center gap-2 sm:justify-end">
                    <span className="mr-1 font-mono text-sm font-bold text-[rgb(var(--fg-default))]">
                      {money(offer.commercialDraft)}
                    </span>
                    {offer.status === "sent" ? (
                      <>
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
                          }}
                        />
                        <button
                          type="button"
                          disabled={pending && cancelingId === offer.id}
                          onClick={() => {
                            if (
                              !window.confirm(
                                "Cancel this private offer? The artist will no longer see it.",
                              )
                            ) {
                              return;
                            }
                            setCancelingId(offer.id);
                            startTransition(async () => {
                              const result = await cancelPrivateOfferAction(offer.id);
                              if (!result.ok) {
                                toast(result.error, "error");
                              } else {
                                toast("Private offer canceled.", "success");
                                router.refresh();
                              }
                              setCancelingId(null);
                            });
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
            ))}
          </ul>
        )
      ) : null}
    </section>
  );
}
