"use client";

import type { PurchaseCommercialSnapshot } from "@skitza/db";
import { useMemo, useState } from "react";

import {
  PrivateOfferManager,
  type ProducerPrivateOfferItem,
} from "~/components/dashboard/offers/private-offer-manager";
import { PrivateOfferShareModal } from "~/components/dashboard/offers/private-offer-share";

const DAY_MS = 24 * 60 * 60 * 1_000;

function snapshot(name: string, totalCents: number, currency: string): PurchaseCommercialSnapshot {
  return {
    version: 2,
    bookingEnabled: false,
    productOrOfferName: name,
    service: "Production",
    deliverables: ["Final master", "Instrumental"],
    lineItems: [
      {
        label: name,
        quantity: 1,
        listUnitPriceCents: totalCents,
        unitPriceCents: totalCents,
        totalCents,
      },
    ],
    listSubtotalCents: totalCents,
    discountCents: 0,
    subtotalCents: totalCents,
    tax: { mode: "tax_free", ratePct: 0, amountCents: 0 },
    totalCents,
    currency,
    includedSongSpaces: 1,
    session: null,
    revisionRule: { kind: "fixed", count: 2 },
    royaltyTerms: null,
    rights: ["Artist may release the final master."],
    selectedPaymentPlan: null,
    offeredPaymentPlans: [{ kind: "full" }],
    agreementText: "The displayed private-offer terms are the complete agreement.",
    agreementMode: "none",
  };
}

type FixtureInput = Readonly<{
  sequence: number;
  name: string;
  totalCents: number;
  currency: string;
  status: ProducerPrivateOfferItem["status"];
  recipientName: string;
  recipientEmail: string;
  expiresInDays: number;
  createdDaysAgo: number;
  acceptedDaysAgo?: number;
  targetProjectTitle?: string;
}>;

function fixture(input: FixtureInput): ProducerPrivateOfferItem {
  const now = Date.now();
  const createdAt = new Date(now - input.createdDaysAgo * DAY_MS);
  return {
    id: `00000000-0000-4000-8000-${String(input.sequence).padStart(12, "0")}`,
    status: input.status,
    commercialDraft: snapshot(input.name, input.totalCents, input.currency),
    expiresAt: new Date(now + input.expiresInDays * DAY_MS),
    acceptedAt:
      input.acceptedDaysAgo === undefined ? null : new Date(now - input.acceptedDaysAgo * DAY_MS),
    createdAt,
    updatedAt: createdAt,
    clientContactId: `10000000-0000-4000-8000-${String(input.sequence).padStart(12, "0")}`,
    recipientName: input.recipientName,
    recipientEmail: input.recipientEmail,
    targetProjectId: null,
    targetProjectTitle: input.targetProjectTitle ?? null,
    purchaseId: null,
    purchaseLifecycleStatus: null,
  };
}

function buildOffers(): ProducerPrivateOfferItem[] {
  const waiting: ProducerPrivateOfferItem[] = [
    fixture({
      sequence: 1,
      name: "Mix & Master — EP",
      totalCents: 320_000,
      currency: "ILS",
      status: "sent",
      recipientName: "Noa Levi",
      recipientEmail: "noa@example.test",
      expiresInDays: 0.8,
      createdDaysAgo: 13,
    }),
    fixture({
      sequence: 2,
      name: "Single production",
      totalCents: 240_000,
      currency: "ILS",
      status: "sent",
      recipientName: "Amit Cohen",
      recipientEmail: "amit@example.test",
      expiresInDays: 2.5,
      createdDaysAgo: 11,
      targetProjectTitle: "Summer single",
    }),
    fixture({
      sequence: 3,
      name: "Vocal recording day",
      totalCents: 95_000,
      currency: "ILS",
      status: "sent",
      recipientName: "Maya Stone",
      recipientEmail: "maya@example.test",
      expiresInDays: 12,
      createdDaysAgo: 2,
    }),
  ];

  const history: ProducerPrivateOfferItem[] = [
    fixture({
      sequence: 4,
      name: "Album deal — 8 tracks",
      totalCents: 1_800_000,
      currency: "ILS",
      status: "accepted",
      recipientName: "Noa Levi",
      recipientEmail: "noa@example.test",
      expiresInDays: 3,
      createdDaysAgo: 6,
      acceptedDaysAgo: 4,
    }),
    fixture({
      sequence: 5,
      name: "Podcast intro pack",
      totalCents: 60_000,
      currency: "ILS",
      status: "declined",
      recipientName: "Amit Cohen",
      recipientEmail: "amit@example.test",
      expiresInDays: 2,
      createdDaysAgo: 9,
    }),
  ];
  for (let index = 0; index < 9; index += 1) {
    history.push(
      fixture({
        sequence: 6 + index,
        name: `Session bundle ${String(index + 1)}`,
        totalCents: 45_000 + index * 5_000,
        currency: "ILS",
        status: index % 2 === 0 ? "expired" : "canceled",
        recipientName: index % 2 === 0 ? "Maya Stone" : "Daniel Bar",
        recipientEmail: index % 2 === 0 ? "maya@example.test" : "daniel@example.test",
        expiresInDays: -3,
        createdDaysAgo: 20 + index,
      }),
    );
  }
  return [...waiting, ...history];
}

const SENT_PREVIEW = {
  offerId: "00000000-0000-4000-8000-000000000001",
  offerName: "Mix & Master — EP",
  recipientName: "Noa Levi",
  recipientEmail: "noa@example.test",
} as const;

export function Sk294OfferShareGallery() {
  const offers = useMemo(buildOffers, []);
  const [sentPreview, setSentPreview] = useState<"delivered" | "email-failed" | null>(null);

  return (
    <main className="mx-auto w-full max-w-[900px] space-y-8 px-4 py-8 sm:px-6">
      <header>
        <p className="font-mono text-[10px] font-bold tracking-[0.14em] text-[rgb(var(--fg-muted))] uppercase">
          SK-294 preview
        </p>
        <h1 className="font-display text-2xl font-extrabold text-[rgb(var(--fg-default))]">
          Private-offer share & work queue
        </h1>
      </header>

      <PrivateOfferManager
        recipients={[
          {
            id: "10000000-0000-4000-8000-000000000001",
            name: "Noa Levi",
            email: "noa@example.test",
            projects: [],
          },
          {
            id: "10000000-0000-4000-8000-000000000002",
            name: "Amit Cohen",
            email: "amit@example.test",
            projects: [],
          },
        ]}
        offers={offers}
        defaultCurrency="ILS"
        taxMode="tax_free"
        taxRatePct={0}
        producerSlug="dev-studio"
      />

      <section
        aria-label="Post-send popup previews"
        className="rounded-[var(--radius-lg)] border border-dashed p-4"
        style={{ borderColor: "rgb(var(--border-subtle))" }}
      >
        <p className="text-xs text-[rgb(var(--fg-muted))]">
          The popup below normally opens right after a real send. A real send needs an authenticated
          producer, so these buttons mount the two variants directly.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => {
              setSentPreview("delivered");
            }}
            className="sk-press min-h-11 rounded-[var(--radius-lg)] border px-4 text-[13px] font-semibold text-[rgb(var(--fg-default))]"
            style={{ borderColor: "rgb(var(--border-subtle))" }}
          >
            Preview post-send popup
          </button>
          <button
            type="button"
            onClick={() => {
              setSentPreview("email-failed");
            }}
            className="sk-press min-h-11 rounded-[var(--radius-lg)] border px-4 text-[13px] font-semibold text-[rgb(var(--fg-default))]"
            style={{ borderColor: "rgb(var(--border-subtle))" }}
          >
            Preview email-failed variant
          </button>
        </div>
      </section>

      <PrivateOfferShareModal
        open={sentPreview !== null}
        onClose={() => {
          setSentPreview(null);
        }}
        offer={
          sentPreview === null
            ? null
            : { ...SENT_PREVIEW, emailDelivered: sentPreview === "delivered" }
        }
        producerSlug="dev-studio"
        occasion="sent"
      />
    </main>
  );
}
