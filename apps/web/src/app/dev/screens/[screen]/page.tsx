import { notFound } from "next/navigation";

import {
  WorkspaceListView,
  type WorkspaceKPIs,
} from "~/components/dashboard/clients-projects/workspace-list-view";
import {
  ClientSpaceHero,
  type ClientSpaceHeroData,
} from "~/components/dashboard/clients/client-space-hero";
import { ClientMoneyLedger } from "~/components/dashboard/clients/client-money-ledger";
import type { ClientCardData } from "~/components/dashboard/clients/client-card";
import { ProjectRow, type ProjectRowData } from "~/components/dashboard/projects/project-row";
import { SongSpace } from "~/components/dashboard/song/song-space";
import {
  PurchaseStatusCard,
  type PurchaseStage,
} from "~/components/artist/home/purchase-status-card";

import { ProductDetailScreen } from "~/components/artist/purchase/product-detail-screen";
import { ChoosePlanScreen } from "~/components/artist/purchase/choose-plan-screen";
import { PaymentInstructionsScreen } from "~/components/artist/purchase/payment-instructions-screen";
import { RequestSentScreen } from "~/components/artist/purchase/request-sent-screen";
import { ReviewAgreeScreen } from "~/components/artist/purchase/review-agree-screen";
import { UploadProofScreen } from "~/components/artist/purchase/upload-proof-screen";
import { buildAgreementTerms } from "~/components/artist/purchase/purchase-data";
import { PaymentProofReview } from "~/components/dashboard/requests/payment-proof-review";
import {
  PendingPaymentProofs,
  type PendingPaymentProof,
} from "~/components/dashboard/requests/pending-payment-proofs";
import {
  livePlanOptions,
  MOCK_PRODUCER,
  MOCK_PRODUCT,
} from "~/components/artist/purchase/pay-data";
import { deriveGradient } from "~/lib/clients/derive-gradient";
import { UploadModalDevScreen } from "~/components/dev/upload-modal-dev-screen";
import { CLIENT_ARCHIVE_BLOCKED_MESSAGE } from "~/server/domain/client-management/service";

const DEV_REQUEST_ID = "00000000-0000-4000-8000-000000000001";
const DEV_PROOF_ID = "00000000-0000-4000-8000-000000000002";
const DEV_USD_PROOF_ID = "00000000-0000-4000-8000-000000000003";
const DEV_PENDING_PROOF: PendingPaymentProof = {
  proofId: DEV_PROOF_ID,
  purchaseRequestId: DEV_REQUEST_ID,
  refNumber: "SK-7F3QK2",
  artistName: "Maya Cohen",
  productNameSnapshot: "Premium Single Production",
  amountCents: 120_000,
  totalCents: 240_000,
  currency: "ILS",
  originalFileName: "bit-receipt-full.png",
  contentType: "image/png",
  sizeBytes: 248_320,
  proofNote: "Deposit sent by Bit. The transfer reference is visible at the bottom.",
  createdAt: new Date("2026-07-11T16:30:00.000Z"),
};
const DEV_PLAN_OPTIONS = livePlanOptions([
  {
    kind: "full",
    charges: [240000],
    dueNowCents: 240000,
    labels: ["Due today"],
  },
  {
    kind: "split_50_50",
    charges: [120000, 120000],
    dueNowCents: 120000,
    labels: ["Due today", "On delivery"],
  },
  {
    kind: "monthly",
    installments: 3,
    charges: [80000, 80000, 80000],
    dueNowCents: 80000,
    labels: ["Due today", "Month 2", "Month 3"],
  },
]);

const DEV_PROJECTS = [
  {
    id: "project-lior",
    title: "Full production",
    client: "Lior Tansky",
    clientEmail: "lior@example.com",
    progress: 62,
    balance: 0,
    deadline: "Jul 28",
    status: "In production",
    statusTone: "ok",
    currency: "ILS",
    updatedAtIso: "2026-07-14T07:00:00.000Z",
    deadlineAtIso: "2026-07-28T12:00:00.000Z",
  },
  {
    id: "project-maya",
    title: "Debut single",
    client: "Maya Cohen",
    clientEmail: "maya@example.com",
    progress: 30,
    balance: 120_000,
    deadline: "3d",
    status: "Needs attention",
    statusTone: "danger",
    currency: "ILS",
    updatedAtIso: "2026-07-13T07:00:00.000Z",
    deadlineAtIso: "2026-07-17T12:00:00.000Z",
  },
] satisfies ProjectRowData[];

const DEV_CLIENTS = [
  {
    id: "client-lior",
    name: "Lior Tansky",
    email: "lior@example.com",
    phone: "+972 50 123 4567",
    notes: "Prefers afternoon sessions.",
    tags: ["Production"],
    archived: false,
    archiveBlockedReason: CLIENT_ARCHIVE_BLOCKED_MESSAGE,
    linkState: "active",
    projects: 2,
    lifetime: 150_000,
    owed: 0,
    needsAttention: false,
    currency: "ILS",
    lastActivityIso: "2026-07-14T07:00:00.000Z",
    joinedAtIso: "2026-05-18T07:00:00.000Z",
  },
  {
    id: "client-maya",
    name: "Maya Cohen",
    email: "maya@example.com",
    phone: null,
    notes: null,
    tags: ["Single"],
    archived: false,
    archiveBlockedReason: CLIENT_ARCHIVE_BLOCKED_MESSAGE,
    linkState: "pending",
    projects: 1,
    lifetime: 0,
    owed: 120_000,
    needsAttention: true,
    currency: "ILS",
    lastActivityIso: "2026-07-13T07:00:00.000Z",
    joinedAtIso: "2026-06-05T07:00:00.000Z",
  },
  {
    id: "client-dana",
    name: "Dana Archived",
    email: "dana@example.com",
    phone: null,
    notes: "Paused indefinitely.",
    tags: ["Archived"],
    archived: true,
    linkState: "none",
    projects: 0,
    lifetime: 0,
    owed: 0,
    needsAttention: false,
    currency: "ILS",
    lastActivityIso: "2026-05-30T07:00:00.000Z",
    joinedAtIso: "2026-04-12T07:00:00.000Z",
  },
] satisfies ClientCardData[];

const DEV_WORKSPACE_KPIS = {
  earnings: 150_000,
  outstanding: 120_000,
  needsAttention: 1,
  nextDeadline: "3d",
  nextDeadlineLabel: "Maya — Debut single",
  currency: "ILS",
} satisfies WorkspaceKPIs;

const DEV_CLIENT_HERO = {
  id: "client-lior",
  name: "Lior Tansky",
  email: "lior@example.com",
  phone: "+972 50 123 4567",
  notes: null,
  tags: ["Production"],
  archived: false,
  archiveBlockedReason: CLIENT_ARCHIVE_BLOCKED_MESSAGE,
  linkState: "active",
  joinedAtIso: "2026-05-18T07:00:00.000Z",
  lifetime: 150_000,
  outstanding: 0,
  activeProjects: 2,
  currency: "ILS",
} satisfies ClientSpaceHeroData;

// Dev-only screen gallery for the handoff-4 wave (2026-07-05). Renders the
// funnel screens with mock props at /dev/screens/<name> so visual QA can
// screenshot every state at 390×844 WITHOUT a Clerk session. Hard 404 in
// production — this never ships to users. Extend the map as waves land.
type Params = { params: Promise<{ screen: string }> };

export default async function DevScreenPage({ params }: Params) {
  if (process.env.NODE_ENV === "production") notFound();
  const { screen } = await params;

  switch (screen) {
    case "s3":
      return (
        <ProductDetailScreen
          product={MOCK_PRODUCT}
          producer={MOCK_PRODUCER}
          productId="00000000-0000-4000-8000-000000000000"
          previewAgreeHref="/dev/screens/s4"
        />
      );
    case "s3-pending":
      return (
        <ProductDetailScreen
          product={MOCK_PRODUCT}
          producer={MOCK_PRODUCER}
          productId="00000000-0000-4000-8000-000000000000"
          pendingRequest
        />
      );
    case "s4":
      return (
        <ReviewAgreeScreen
          product={MOCK_PRODUCT}
          producer={MOCK_PRODUCER}
          terms={buildAgreementTerms(MOCK_PRODUCER.name, MOCK_PRODUCT.includes)}
          previewSentHref="/dev/screens/s5"
        />
      );
    case "s5":
      return (
        <RequestSentScreen producer={MOCK_PRODUCER} requestRef="SK-7F3QK2" />
      );
    case "s7":
      return (
        <ChoosePlanScreen
          productId={MOCK_PRODUCT.id}
          productName={MOCK_PRODUCT.name}
          producerName={MOCK_PRODUCER.name}
          purchaseRequestId={DEV_REQUEST_ID}
          options={DEV_PLAN_OPTIONS}
          previewNextHref="/dev/screens/s8"
        />
      );
    case "s8":
      return (
        <PaymentInstructionsScreen
          productId={MOCK_PRODUCT.id}
          purchaseRequestId={DEV_REQUEST_ID}
          producerName={MOCK_PRODUCER.name}
          amountDueNowCents={120000}
          paymentDetails={{
            bankTransfer: "Bank Hapoalim\nBranch 613\nAccount 12-345678",
            bitPhone: "052-000-0000",
            note: "Add your SK request number to the transfer note.",
          }}
          productName={MOCK_PRODUCT.name}
          planLabel="Split 50 / 50"
          previewProofHref="/dev/screens/s9"
        />
      );
    case "s9":
    case "s9-awaiting":
    case "s9-rejected":
    case "s9-partial":
    case "s9-paid": {
      const state = screen.slice(3);
      const isPaid = state === "paid";
      const isAwaiting = state === "awaiting";
      const isRejected = state === "rejected";
      const isPartial = state === "partial";
      return (
        <UploadProofScreen
          productName={MOCK_PRODUCT.name}
          producerName={MOCK_PRODUCER.name}
          purchaseRequestId={DEV_REQUEST_ID}
          proofs={
            isAwaiting
              ? [{ id: "proof-1", amountCents: 120000, status: "awaiting" }]
              : isRejected
                ? [{ id: "proof-1", amountCents: 120000, status: "rejected" }]
                : isPaid
                  ? [{ id: "proof-1", amountCents: 240000, status: "paid" }]
                  : isPartial
                    ? [{ id: "proof-1", amountCents: 120000, status: "paid" }]
                    : []
          }
          paidCents={isPaid ? 240000 : isPartial ? 120000 : 0}
          totalCents={240000}
          thisProofCents={isPaid ? 0 : 120000}
          bookingHref={isPartial ? "/artist/book?studio=dev-studio&project=dev-project" : undefined}
          status={isPaid ? "paid" : isAwaiting ? "awaiting" : isRejected ? "rejected" : "empty"}
          rejectionNote={isRejected ? "The amount is cut off in the screenshot." : undefined}
        />
      );
    }
    case "clients-projects":
      return (
        <main
          id="main-content"
          tabIndex={-1}
          className="mx-auto max-w-[1400px] px-4 py-5 sm:px-6 lg:px-8"
        >
          <WorkspaceListView
            projects={DEV_PROJECTS}
            clients={DEV_CLIENTS}
            kpis={DEV_WORKSPACE_KPIS}
            producerSlug="gili"
          />
        </main>
      );
    case "client-space":
      return (
        <main
          id="main-content"
          tabIndex={-1}
          className="mx-auto max-w-[1400px] px-4 py-5 sm:px-6 lg:px-8"
        >
          <ClientSpaceHero client={DEV_CLIENT_HERO} producerSlug="gili" />
          <section className="mt-6" aria-labelledby="dev-client-projects-title">
            <p className="text-[10px] font-bold tracking-[0.14em] text-[rgb(var(--fg-muted))] uppercase">
              Work
            </p>
            <h2
              id="dev-client-projects-title"
              className="font-syne text-xl font-bold text-[rgb(var(--fg-default))]"
            >
              Projects
            </h2>
            <div className="mt-3 flex flex-col gap-2">
              {DEV_PROJECTS.filter((project) => project.client === "Lior Tansky").map((project) => (
                <ProjectRow key={project.id} row={project} hideClient />
              ))}
            </div>
          </section>
          <div className="mt-8">
            <ClientMoneyLedger
              data={{
                currencyTotals: [
                  {
                    currency: "ILS",
                    purchasedCents: 240_003,
                    paidCents: 120_001,
                    remainingCents: 120_002,
                  },
                  {
                    currency: "USD",
                    purchasedCents: 80_000,
                    paidCents: 50_000,
                    remainingCents: 30_000,
                  },
                ],
                projects: [
                  {
                    id: "project-lior",
                    title: "Full production",
                    lifecycleStatus: "active",
                    currencyTotals: [
                      {
                        currency: "ILS",
                        purchasedCents: 240_003,
                        paidCents: 120_001,
                        remainingCents: 120_002,
                      },
                    ],
                    purchases: [
                      {
                        id: "purchase-lior",
                        reference: "SK-7F3QK2",
                        title: "Full production",
                        lifecycleStatus: "active",
                        acceptedAtIso: "2026-07-12T07:00:00.000Z",
                        currency: "ILS",
                        subtotalCents: 240_003,
                        taxCents: 0,
                        totalCents: 240_003,
                        paidCents: 120_001,
                        remainingCents: 120_002,
                        payments: [
                          {
                            id: "payment-lior",
                            amountCents: 120_001,
                            currency: "ILS",
                            paidAtIso: "2026-07-14T07:00:00.000Z",
                            source: "proof",
                            note: null,
                          },
                        ],
                        proofs: [
                          {
                            id: DEV_PROOF_ID,
                            amountCents: 120_001,
                            currency: "ILS",
                            status: "confirmed",
                            originalFileName: "bit-payment-lior.png",
                            createdAtIso: "2026-07-14T06:45:00.000Z",
                            rejectionNote: null,
                          },
                        ],
                      },
                    ],
                  },
                  {
                    id: "project-lior-usd",
                    title: "Mix consultation",
                    lifecycleStatus: "completed",
                    currencyTotals: [
                      {
                        currency: "USD",
                        purchasedCents: 80_000,
                        paidCents: 50_000,
                        remainingCents: 30_000,
                      },
                    ],
                    purchases: [
                      {
                        id: "purchase-lior-usd",
                        reference: "SK-USD123",
                        title: "Mix consultation",
                        lifecycleStatus: "completed",
                        acceptedAtIso: "2026-05-20T07:00:00.000Z",
                        currency: "USD",
                        subtotalCents: 80_000,
                        taxCents: 0,
                        totalCents: 80_000,
                        paidCents: 50_000,
                        remainingCents: 30_000,
                        payments: [
                          {
                            id: "payment-lior-usd",
                            amountCents: 50_000,
                            currency: "USD",
                            paidAtIso: "2026-05-21T07:00:00.000Z",
                            source: "manual",
                            note: "Wire transfer confirmed by the producer.",
                          },
                        ],
                        proofs: [
                          {
                            id: DEV_USD_PROOF_ID,
                            amountCents: 30_000,
                            currency: "USD",
                            status: "pending",
                            originalFileName: "usd-balance-transfer.pdf",
                            createdAtIso: "2026-07-16T06:45:00.000Z",
                            rejectionNote: null,
                          },
                        ],
                      },
                    ],
                  },
                ],
              }}
            />
          </div>
        </main>
      );
    case "project-space":
      return (
        <main id="main-content" tabIndex={-1} className="mx-auto max-w-[1400px] px-4 py-5 sm:px-6">
          <SongSpace
            mode="single"
            song={{
              id: "song-lior",
              title: "Midnight Drive",
              currentVersion: "v3",
              noteCount: 2,
              durationMs: 193_000,
              workflowStage: "mixing",
              progress: 62,
              deadline: "Jul 28",
              isOverdue: false,
              revisionCount: 2,
            }}
            project={{ id: "project-lior", name: "Full production" }}
            client={{
              id: "client-lior",
              name: "Lior Tansky",
              email: "lior@example.com",
              linkState: "active",
            }}
            versions={[]}
            sessions={[]}
            gradientToken={deriveGradient("Midnight Drive")}
          />
        </main>
      );
    case "add-song":
      return <UploadModalDevScreen />;
    case "gate2-queue":
      return (
        <main className="mx-auto w-full max-w-[1040px] px-4 py-8 sm:px-6 lg:px-8">
          <PendingPaymentProofs proofs={[DEV_PENDING_PROOF]} />
        </main>
      );
    case "gate2-review":
      return (
        <main className="mx-auto w-full max-w-[1040px] px-4 py-8 sm:px-6 lg:px-8">
          <PaymentProofReview
            proof={{
              ...DEV_PENDING_PROOF,
              status: "pending",
              rejectionNote: null,
              confirmedAt: null,
              rejectedAt: null,
              signedUrl: "/icon",
              expiresInSeconds: 300,
            }}
          />
        </main>
      );
    default: {
      if (screen.startsWith("s6-")) {
        const stage = screen.slice(3) as PurchaseStage;
        const valid: PurchaseStage[] = [
          "pending_review",
          "awaiting_payment",
          "verifying",
          "paid",
          "declined",
        ];
        if (!valid.includes(stage)) notFound();
        return (
          <div className="mx-auto max-w-[440px] px-5 py-16">
            <PurchaseStatusCard
              stage={stage}
              productName={MOCK_PRODUCT.name}
              priceCents={MOCK_PRODUCT.priceCents}
              remainingCents={
                stage === "paid"
                  ? Math.ceil(MOCK_PRODUCT.priceCents / 2)
                  : stage === "declined"
                    ? 0
                    : MOCK_PRODUCT.priceCents
              }
              producerName={MOCK_PRODUCER.name}
              {...(stage === "awaiting_payment"
                ? {
                    actionHref: "/dev/screens/s7",
                    actionLabel: "Choose a payment plan",
                  }
                : stage === "paid"
                  ? { actionHref: "/dev/screens/s8", actionLabel: "Make next payment" }
                  : {})}
            />
          </div>
        );
      }
      notFound();
    }
  }
}
