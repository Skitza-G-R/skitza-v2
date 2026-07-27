"use client";

import { useState } from "react";

import { ArtistPaymentActionsCard } from "~/components/artist/home/payment-actions-card";
import { PurchaseStatusCard } from "~/components/artist/home/purchase-status-card";
import { PurchaseRequestsList } from "~/components/dashboard/requests/purchase-requests-list";
import {
  PaymentHistoryView,
  type PaymentHistoryProject,
  type PaymentHistorySectionDescriptor,
} from "~/components/payments/payment-history-view";
import { ProducerPaymentWorkspace } from "~/components/payments/producer-payment-workspace";
import type { PaymentWorkspaceBucket } from "~/components/payments/producer-payment-workspace-model";

type Surface =
  | "producer-payments"
  | "artist-payments"
  | "project"
  | "client"
  | "dashboard"
  | "artist-home"
  | "requests";

const SURFACES: readonly { id: Surface; label: string }[] = [
  { id: "producer-payments", label: "Producer Payments" },
  { id: "artist-payments", label: "Artist Payments" },
  { id: "project", label: "Project" },
  { id: "client", label: "Client" },
  { id: "dashboard", label: "Dashboard" },
  { id: "artist-home", label: "Artist Home" },
  { id: "requests", label: "Requests" },
];

const SHARED_PROJECT: PaymentHistoryProject = {
  id: "project-sk69",
  title: "Midnight Bloom",
  status: { label: "Archived · balance remains", tone: "warning" },
  currencyTotals: [{ currency: "ILS", dueNowCents: 60_000, totalRemainingCents: 60_000 }],
  purchases: [
    {
      id: "purchase-sk69",
      reference: "SK-69SAFE",
      title: "Single production",
      counterpartyLabel: "Maya Cohen",
      currency: "ILS",
      status: { label: "Overdue", tone: "danger" },
      defaultOpen: true,
      totalCents: 120_000,
      paidCents: 60_000,
      dueNowCents: 60_000,
      totalRemainingCents: 60_000,
      delivery: {
        key: "overdue_locked",
        label: "Overdue · downloads locked",
        description: "Listening remains available, but downloads require full payment.",
        paidCents: 60_000,
        waivedCents: 0,
        remainingCents: 60_000,
        overdue: true,
        activeOverrideVersionLabels: [],
        googleDriveLinks: [],
        withheldGoogleDriveLinkCount: 0,
      },
      frozenTerms: {
        frozenAtIso: "2026-06-01T09:00:00.000Z",
        productName: "Single production",
        deliverables: ["Mixed master", "Instrumental", "Vocal stems"],
        lineItems: [
          {
            id: "line-sk69",
            label: "Single production",
            quantity: 1,
            unitPriceCents: 120_000,
            totalCents: 120_000,
          },
        ],
        subtotalCents: 120_000,
        discountCents: 0,
        taxCents: 0,
        totalCents: 120_000,
        detailRows: [
          { label: "Song spaces", value: "1" },
          { label: "Session allowance", value: "2 × 120 min · Studio" },
          { label: "Revisions", value: "2 rounds" },
          { label: "Royalty terms", value: "No producer royalty" },
        ],
        rights: ["Artist owns the approved master."],
        agreementText: "The exact accepted production agreement remains frozen for this purchase.",
      },
      acceptance: {
        acceptedAtIso: "2026-06-01T09:00:00.000Z",
        acceptedByLabel: "Maya Cohen accepted the exact terms",
        statement: "Price, plan, agreement, and schedule are the immutable accepted record.",
      },
      plan: {
        label: "50 / 50",
        description: "The first half activated the work. The second half is now due.",
      },
      schedule: [
        {
          id: "installment-1-sk69",
          position: 1,
          label: "Payment 1",
          amountCents: 60_000,
          paidCents: 60_000,
          waivedCents: 0,
          remainingCents: 0,
          dueAtIso: "2026-06-01T09:00:00.000Z",
          trigger: "At acceptance",
          status: { label: "Paid", tone: "success" },
        },
        {
          id: "installment-2-sk69",
          position: 2,
          label: "Payment 2",
          amountCents: 60_000,
          paidCents: 0,
          waivedCents: 0,
          remainingCents: 60_000,
          dueAtIso: "2026-07-18T09:00:00.000Z",
          trigger: "When the artist approves the final version",
          status: { label: "Overdue", tone: "danger" },
        },
      ],
      nextPayment: {
        amountCents: 60_000,
        dueAtIso: "2026-07-18T09:00:00.000Z",
        trigger: "When the artist approves the final version",
      },
      showPayNextPayment: true,
      currentInstructions: {
        title: "Current producer payment instructions",
        updatedAtIso: null,
        fields: [
          { label: "Bank transfer", value: "Bank Hapoalim · branch 613 · account 12-345678" },
          { label: "Bit phone", value: "052-000-0000" },
        ],
        note: "Include SK-69SAFE in the transfer note.",
      },
      proofs: [
        {
          id: "proof-sk69",
          installmentLabel: "Payment 1",
          amountCents: 60_000,
          currency: "ILS",
          status: "confirmed",
          originalFileName: "bank-transfer.pdf",
          submittedAtIso: "2026-06-01T10:00:00.000Z",
          reviewedAtIso: "2026-06-01T10:15:00.000Z",
          note: "First installment transfer.",
          rejectionNote: null,
          detailAvailable: false,
        },
      ],
      payments: [
        {
          id: "payment-sk69",
          installmentLabel: "Payment 1",
          amountCents: 60_000,
          currency: "ILS",
          paidAtIso: "2026-06-01T10:15:00.000Z",
          sourceLabel: "Confirmed from proof",
          note: null,
        },
      ],
      corrections: [
        {
          id: "correction-sk69",
          label: "Payment corrected",
          amountDeltaCents: -5_000,
          currency: "ILS",
          occurredAtIso: "2026-06-02T08:00:00.000Z",
          reason: "Corrected the represented transfer amount.",
        },
      ],
      waivers: [],
      cancellations: [],
      pauseHistory: [
        {
          id: "pause-sk69",
          actionLabel: "Payments paused",
          occurredAtIso: "2026-07-19T08:00:00.000Z",
          reason: "Second installment is overdue.",
        },
      ],
      downloadOverrideHistory: [
        {
          id: "override-sk69",
          actionLabel: "Early download allowed",
          trackVersionLabel: "Final mix v4",
          occurredAtIso: "2026-07-18T11:00:00.000Z",
          reason: "The producer enabled the recorded version override.",
          expiresAtIso: null,
        },
      ],
    },
  ],
};

const SHARED_PURCHASE = SHARED_PROJECT.purchases[0];

if (!SHARED_PURCHASE) {
  throw new Error("The SK-69 safe browser fixture requires its shared purchase.");
}

const UPCOMING_PROJECT: PaymentHistoryProject = {
  ...SHARED_PROJECT,
  id: "project-sk120-upcoming",
  title: "Neon Rooms",
  status: { label: "Active", tone: "active" },
  currencyTotals: [{ currency: "USD", dueNowCents: 0, totalRemainingCents: 180_000 }],
  purchases: [
    {
      ...SHARED_PURCHASE,
      id: "purchase-sk120-upcoming",
      reference: "SK-120USD",
      title: "EP mix package",
      currency: "USD",
      status: { label: "Upcoming", tone: "accent" },
      defaultOpen: false,
      totalCents: 180_000,
      paidCents: 0,
      dueNowCents: 0,
      totalRemainingCents: 180_000,
      delivery: {
        ...SHARED_PURCHASE.delivery,
        key: "locked",
        label: "Downloads locked",
        description: "Downloads and extra deliverables unlock only after full payment.",
        paidCents: 0,
        remainingCents: 180_000,
        overdue: false,
      },
      frozenTerms: {
        ...SHARED_PURCHASE.frozenTerms,
        productName: "EP mix package",
        deliverables: ["Four mixed masters", "Instrumentals", "Vocal stems"],
        lineItems: [
          {
            id: "line-sk120-upcoming",
            label: "EP mix package",
            quantity: 1,
            unitPriceCents: 180_000,
            totalCents: 180_000,
          },
        ],
        subtotalCents: 180_000,
        totalCents: 180_000,
      },
      acceptance: {
        ...SHARED_PURCHASE.acceptance,
        acceptedAtIso: "2026-07-22T09:00:00.000Z",
      },
      plan: {
        label: "One payment",
        description: "The full balance is scheduled before delivery.",
      },
      schedule: [
        {
          id: "installment-sk120-upcoming",
          position: 1,
          label: "Payment 1",
          amountCents: 180_000,
          paidCents: 0,
          waivedCents: 0,
          remainingCents: 180_000,
          dueAtIso: "2026-08-12T09:00:00.000Z",
          trigger: "Before final delivery",
          status: { label: "Upcoming", tone: "accent" },
        },
      ],
      nextPayment: {
        amountCents: 180_000,
        dueAtIso: "2026-08-12T09:00:00.000Z",
        trigger: "Before final delivery",
      },
      showPayNextPayment: false,
      proofs: [],
      payments: [],
      corrections: [],
      waivers: [],
      cancellations: [],
      pauseHistory: [],
      downloadOverrideHistory: [],
    },
  ],
};

const EXTREME_MONEY_PROJECT: PaymentHistoryProject = {
  ...SHARED_PROJECT,
  id: "project-sk120-extreme-money",
  title: "Symphonic Album & Global Release Campaign",
  status: { label: "Active", tone: "active" },
  currencyTotals: [
    { currency: "ILS", dueNowCents: 123_456_789, totalRemainingCents: 530_865_309 },
  ],
  purchases: [
    {
      ...SHARED_PURCHASE,
      id: "purchase-sk120-extreme-money",
      reference: "SK-120MAX",
      title: "12-track album production and spatial masters",
      currency: "ILS",
      status: { label: "Due now", tone: "warning" },
      defaultOpen: false,
      totalCents: 987_654_321,
      paidCents: 456_789_012,
      dueNowCents: 123_456_789,
      totalRemainingCents: 530_865_309,
      delivery: {
        ...SHARED_PURCHASE.delivery,
        key: "locked",
        label: "Downloads locked",
        description: "Downloads and extra deliverables unlock only after full payment.",
        paidCents: 456_789_012,
        remainingCents: 530_865_309,
        overdue: false,
      },
      frozenTerms: {
        ...SHARED_PURCHASE.frozenTerms,
        frozenAtIso: "2026-07-24T09:00:00.000Z",
        productName: "12-track album production and spatial masters",
        deliverables: [
          "12 mixed masters",
          "12 instrumental masters",
          "Dolby Atmos spatial masters",
        ],
        lineItems: [
          {
            id: "line-sk120-extreme-money",
            label: "Album production and spatial-master package",
            quantity: 1,
            unitPriceCents: 987_654_321,
            totalCents: 987_654_321,
          },
        ],
        subtotalCents: 987_654_321,
        totalCents: 987_654_321,
      },
      acceptance: {
        ...SHARED_PURCHASE.acceptance,
        acceptedAtIso: "2026-07-24T09:00:00.000Z",
      },
      plan: {
        label: "Three milestones",
        description: "Deposit, orchestral recording lock, and final delivery.",
      },
      schedule: [
        {
          id: "installment-1-sk120-extreme-money",
          position: 1,
          label: "Deposit",
          amountCents: 456_789_012,
          paidCents: 456_789_012,
          waivedCents: 0,
          remainingCents: 0,
          dueAtIso: "2026-07-24T09:00:00.000Z",
          trigger: "At acceptance",
          status: { label: "Paid", tone: "success" },
        },
        {
          id: "installment-2-sk120-extreme-money",
          position: 2,
          label: "Orchestral recording lock",
          amountCents: 123_456_789,
          paidCents: 0,
          waivedCents: 0,
          remainingCents: 123_456_789,
          dueAtIso: "2026-07-27T09:00:00.000Z",
          trigger: "At orchestral recording lock",
          status: { label: "Due now", tone: "warning" },
        },
        {
          id: "installment-3-sk120-extreme-money",
          position: 3,
          label: "Final delivery",
          amountCents: 407_408_520,
          paidCents: 0,
          waivedCents: 0,
          remainingCents: 407_408_520,
          dueAtIso: "2026-10-30T09:00:00.000Z",
          trigger: "Before final delivery",
          status: { label: "Upcoming", tone: "accent" },
        },
      ],
      nextPayment: {
        amountCents: 123_456_789,
        dueAtIso: "2026-07-27T09:00:00.000Z",
        trigger: "At orchestral recording lock",
      },
      showPayNextPayment: false,
      currentInstructions: {
        title: "Current producer payment instructions",
        updatedAtIso: null,
        fields: [
          {
            label: "Bank transfer",
            value: "Bank Hapoalim · branch 613 · account 12-345678",
          },
          { label: "Bit phone", value: "052-000-0000" },
        ],
        note: "Include SK-120MAX in the transfer note.",
      },
      proofs: [
        {
          id: "proof-sk120-extreme-money",
          installmentLabel: "Deposit",
          amountCents: 456_789_012,
          currency: "ILS",
          status: "confirmed",
          originalFileName: "album-deposit-transfer.pdf",
          submittedAtIso: "2026-07-24T09:30:00.000Z",
          reviewedAtIso: "2026-07-24T09:45:00.000Z",
          note: "Accepted-purchase deposit transfer.",
          rejectionNote: null,
          detailAvailable: false,
        },
      ],
      payments: [
        {
          id: "payment-sk120-extreme-money",
          installmentLabel: "Deposit",
          amountCents: 456_789_012,
          currency: "ILS",
          paidAtIso: "2026-07-24T09:45:00.000Z",
          sourceLabel: "Confirmed from proof",
          note: null,
        },
      ],
      corrections: [],
      waivers: [],
      cancellations: [],
      pauseHistory: [],
      downloadOverrideHistory: [],
    },
  ],
};

const WORKSPACE_BUCKETS: readonly PaymentWorkspaceBucket[] = [
  { id: "needs_review", label: "Needs review", projects: [] },
  {
    id: "due_or_overdue",
    label: "Due now",
    projects: [SHARED_PROJECT, EXTREME_MONEY_PROJECT],
  },
  { id: "upcoming", label: "Upcoming", projects: [UPCOMING_PROJECT] },
  { id: "history", label: "History", projects: [] },
];

const SECTIONS: Record<
  Exclude<Surface, "dashboard" | "artist-home" | "requests">,
  PaymentHistorySectionDescriptor
> = {
  "producer-payments": {
    id: "sk69-producer-due",
    eyebrow: "Active balances",
    title: "Due and overdue",
    description: "Producer Payments keeps proof review and balances out of Requests.",
    emptyTitle: "Nothing due",
    emptyDescription: "Due purchases appear here.",
  },
  "artist-payments": {
    id: "sk69-artist-active",
    eyebrow: "Active balances",
    title: "Balances and actions",
    description: "Artist Payments shows the same accepted purchase and the next payment action.",
    emptyTitle: "No active balances",
    emptyDescription: "Active purchases appear here.",
  },
  project: {
    id: "sk69-project",
    eyebrow: "Accepted purchase record",
    title: "Project payments",
    description: "The project keeps its complete frozen purchase and ledger history.",
    emptyTitle: "No purchases",
    emptyDescription: "Accepted purchases appear here.",
  },
  client: {
    id: "sk69-client",
    eyebrow: "Commercial history",
    title: "Client payments",
    description: "All client purchases are grouped by project, then purchase.",
    emptyTitle: "No purchases",
    emptyDescription: "Accepted purchases appear here.",
  },
};

export function Sk69PaymentsDevScreen() {
  const [surface, setSurface] = useState<Surface>("producer-payments");
  const paymentHistorySurface = surface === "artist-payments" || surface === "project";

  return (
    <main className="mx-auto min-h-screen w-full max-w-[1180px] px-4 py-5 sm:px-6 sm:py-8">
      <div className="mb-5 rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-3">
        <p className="font-mono text-[10px] font-bold tracking-[0.12em] text-[rgb(var(--brand-primary-text))] uppercase">
          SK-69 safe browser fixture
        </p>
        <p className="mt-1 text-xs text-[rgb(var(--fg-muted))]">
          No database or payment writes. Every payment surface below uses the same purchase truth.
        </p>
        <div
          role="tablist"
          aria-label="SK-69 verification surfaces"
          className="mt-3 flex max-w-full gap-2 overflow-x-auto pb-1"
        >
          {SURFACES.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={surface === item.id}
              onClick={() => {
                setSurface(item.id);
              }}
              className={`min-h-11 shrink-0 rounded-[var(--radius-lg)] border px-3 text-xs font-bold focus-visible:ring-2 focus-visible:ring-[rgb(var(--focus-ring))] focus-visible:outline-none ${
                surface === item.id
                  ? "border-[rgb(var(--brand-primary))] bg-[rgb(var(--brand-primary))] text-[rgb(var(--fg-on-brand))]"
                  : "border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-background))] text-[rgb(var(--fg-secondary))]"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      <section data-testid={`sk69-surface-${surface}`}>
        {surface === "producer-payments" ? (
          <ProducerPaymentWorkspace
            buckets={WORKSPACE_BUCKETS}
            scope="global"
            defaultView="open"
          />
        ) : null}
        {paymentHistorySurface ? (
          <PaymentHistoryView
            role={surface === "artist-payments" ? "artist" : "producer"}
            data={{
              section: SECTIONS[surface],
              currencyTotals: SHARED_PROJECT.currencyTotals,
              projects: [SHARED_PROJECT],
            }}
          />
        ) : null}
        {surface === "client" ? (
          <ProducerPaymentWorkspace
            buckets={WORKSPACE_BUCKETS}
            scope="client"
            clientLabel="Maya Cohen"
            defaultView="all"
          />
        ) : null}
        {surface === "dashboard" ? <DashboardFixture /> : null}
        {surface === "artist-home" ? <ArtistHomeFixture /> : null}
        {surface === "requests" ? <RequestsFixture /> : null}
      </section>
    </main>
  );
}

function DashboardFixture() {
  return (
    <section aria-labelledby="sk69-dashboard-heading">
      <h1
        id="sk69-dashboard-heading"
        className="font-display text-3xl font-extrabold text-[rgb(var(--fg-default))]"
      >
        Dashboard actions
      </h1>
      <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
        <ActionFixture
          eyebrow="New work"
          title="Purchase request"
          detail="Maya · Vocal production"
        />
        <ActionFixture
          eyebrow="Payments"
          title="Payment due"
          detail="Maya · Midnight Bloom · Single production"
        />
        <ActionFixture eyebrow="Sessions" title="Session today" detail="Maya · 16:00 · Studio A" />
      </div>
    </section>
  );
}

function ArtistHomeFixture() {
  return (
    <div className="mx-auto max-w-[760px] space-y-4">
      <PurchaseStatusCard
        stage="pending_review"
        productName="Vocal production"
        priceCents={80_000}
        currency="ILS"
        remainingCents={80_000}
        producerName="Gili Studio"
      />
      <ArtistPaymentActionsCard
        payments={[
          {
            purchaseId: "purchase-sk69",
            projectTitle: "Midnight Bloom",
            purchaseTitle: "Single production",
            producerName: "Gili Studio",
            currency: "ILS",
            dueNowCents: 60_000,
            totalRemainingCents: 60_000,
            statusLabel: "Due now",
            payNextAvailable: true,
          },
        ]}
      />
      <ActionFixture
        eyebrow="Sessions"
        title="Next session"
        detail="Midnight Bloom · Tomorrow at 16:00"
      />
    </div>
  );
}

function RequestsFixture() {
  return (
    <section aria-labelledby="sk69-requests-heading">
      <h1
        id="sk69-requests-heading"
        className="font-display mb-4 text-3xl font-extrabold text-[rgb(var(--fg-default))]"
      >
        Requests · new work only
      </h1>
      <PurchaseRequestsList
        requests={[
          {
            id: "00000000-0000-4000-8000-000000000069",
            refNumber: "SK-NEW69",
            artistName: "Maya Cohen",
            artistEmail: "maya@example.test",
            productNameSnapshot: "Vocal production",
            priceCents: 80_000,
            currency: "ILS",
            commercialTermsAvailable: true,
            createdAt: new Date("2026-07-20T08:00:00.000Z"),
          },
        ]}
      />
    </section>
  );
}

function ActionFixture({
  eyebrow,
  title,
  detail,
}: {
  eyebrow: string;
  title: string;
  detail: string;
}) {
  return (
    <article className="min-w-0 rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-4">
      <p className="font-mono text-[10px] font-bold tracking-[0.12em] text-[rgb(var(--brand-primary-text))] uppercase">
        {eyebrow}
      </p>
      <h2 className="mt-1 text-base font-extrabold text-[rgb(var(--fg-default))]">{title}</h2>
      <p className="mt-1 text-xs break-words text-[rgb(var(--fg-muted))]">{detail}</p>
    </article>
  );
}
