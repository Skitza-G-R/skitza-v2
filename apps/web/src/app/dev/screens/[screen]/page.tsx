import { notFound } from "next/navigation";
import type { PurchaseCommercialSnapshot } from "@skitza/db";
import type { ReactNode } from "react";

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
import { ProjectPage } from "~/components/music/project-page";
import {
  MusicLibraryScreen,
  type MusicLibraryProjectRow,
  type MusicLibraryRow,
} from "~/components/music/library-screen";
import {
  Sk8LibraryDevScreen,
  Sk8SongDevScreen,
  Sk94ApprovalDevScreen,
} from "~/components/dev/sk8-music-dev-screen";
import {
  PurchaseStatusCard,
  type PurchaseStage,
} from "~/components/artist/home/purchase-status-card";

import { ProfessionalProductDetail } from "~/components/artist/purchase/professional-product-detail";
import { PurchaseRequestScreen } from "~/components/artist/purchase/purchase-request-screen";
import { ChoosePlanScreen } from "~/components/artist/purchase/choose-plan-screen";
import { PaymentInstructionsScreen } from "~/components/artist/purchase/payment-instructions-screen";
import {
  PaymentSummaryScreen,
  type ArtistPaymentSummaryProof,
} from "~/components/artist/purchase/payment-summary-screen";
import { ProofRecordScreen } from "~/components/artist/purchase/proof-record-screen";
import { RequestSentScreen } from "~/components/artist/purchase/request-sent-screen";
import { ReviewAgreeScreen } from "~/components/artist/purchase/review-agree-screen";
import { UploadProofScreen } from "~/components/artist/purchase/upload-proof-screen";
import { buildAgreementTerms } from "~/components/artist/purchase/purchase-data";
import { PaymentProofReview } from "~/components/dashboard/payments/payment-proof-review";
import { PaymentProofList } from "~/components/dashboard/payments/payment-proof-list";
import { PurchaseRequestCommercialDetails } from "~/components/dashboard/requests/purchase-request-commercial-details";
import { PurchaseRequestReview } from "~/components/dashboard/requests/purchase-request-review";
import type { ProducerPendingPaymentProof } from "~/server/domain/payment-proofs/service";
import {
  livePlanOptions,
  MOCK_PRODUCER,
  MOCK_PRODUCT,
} from "~/components/artist/purchase/pay-data";
import { deriveGradient } from "~/lib/clients/derive-gradient";
import { UploadModalDevScreen } from "~/components/dev/upload-modal-dev-screen";
import { Sk75ProofFlowDevScreen } from "~/components/dev/sk75-proof-flow-dev-screen";
import { Sk69PaymentsDevScreen } from "~/components/dev/sk69-payments-dev-screen";
import {
  ArtistHomeDevPreview,
  ArtistNotificationCenterDevPreview,
  ArtistSessionDetailDevPreview,
  ArtistSessionsHubDevPreview,
  ArtistSettingsDevPreview,
  ArtistStoreCatalogDevPreview,
} from "~/components/dev/artist-platform-standing-previews";
import { ArtistPlatformPreviewShell } from "~/components/dev/artist-platform-preview-shell";
import { PublicSongPlayer } from "~/components/public-song/public-song-player";
import { isDevGalleryAvailable } from "~/lib/dev-gallery-access";
import { CLIENT_ARCHIVE_BLOCKED_MESSAGE } from "~/server/domain/client-management/service";

import { findArtistPlatformPreviewState } from "../../artist-platform/preview-states";

const DEV_REQUEST_ID = "00000000-0000-4000-8000-000000000001";
const DEV_PROOF_ID = "00000000-0000-4000-8000-000000000002";
const DEV_USD_PROOF_ID = "00000000-0000-4000-8000-000000000003";
const DEV_ARTIST_PURCHASE_ID = "00000000-0000-4000-8000-000000000010";
const DEV_ARTIST_STUDIO_ID = "00000000-0000-4000-8000-000000000011";
const DEV_ARTIST_PENDING_PROOF = {
  proofId: "00000000-0000-4000-8000-000000000012",
  installmentId: "00000000-0000-4000-8000-000000000016",
  installmentPosition: 1,
  amountCents: 120_000,
  status: "pending",
  createdAt: new Date("2026-07-20T09:00:00.000Z"),
} satisfies ArtistPaymentSummaryProof;
const DEV_ARTIST_REJECTED_PROOF = {
  ...DEV_ARTIST_PENDING_PROOF,
  proofId: "00000000-0000-4000-8000-000000000013",
  status: "rejected",
} satisfies ArtistPaymentSummaryProof;
const DEV_ARTIST_CONFIRMED_PROOF = {
  ...DEV_ARTIST_PENDING_PROOF,
  proofId: "00000000-0000-4000-8000-000000000014",
  status: "confirmed",
} satisfies ArtistPaymentSummaryProof;
const DEV_ARTIST_FINAL_PROOF = {
  ...DEV_ARTIST_CONFIRMED_PROOF,
  proofId: "00000000-0000-4000-8000-000000000015",
  installmentId: "00000000-0000-4000-8000-000000000017",
  installmentPosition: 2,
  createdAt: new Date("2026-07-28T09:00:00.000Z"),
} satisfies ArtistPaymentSummaryProof;
const DEV_SK72_COMMERCIAL_SNAPSHOT = {
  version: 1,
  productOrOfferName: "Three-song production",
  deliverables: ["Three mixed masters", "Instrumentals", "Vocal stems"],
  lineItems: [
    {
      label: "Production per song",
      quantity: 3,
      listUnitPriceCents: 90_000,
      unitPriceCents: 80_000,
      totalCents: 240_000,
    },
  ],
  listSubtotalCents: 270_000,
  discountCents: 30_000,
  subtotalCents: 240_000,
  tax: { mode: "tax_added", ratePct: 18, amountCents: 43_200 },
  totalCents: 283_200,
  currency: "ILS",
  includedSongSpaces: 3,
  session: null,
  revisionRule: { kind: "fixed", count: 2 },
  royaltyTerms: {
    master: { mode: "none" },
    composition: { mode: "percentage", bps: 500, role: "composer" },
  },
  rights: ["Artist owns the approved masters."],
  selectedPaymentPlan: { kind: "split_50_50" },
  offeredPaymentPlans: [{ kind: "full" }, { kind: "split_50_50" }],
  agreementText:
    "Exact production agreement for three songs.\nProject target: Start a new project.\nExact installment schedule:\n- 1. 50% due at acceptance\n- 2. 50% due when the artist approves the final version",
} satisfies PurchaseCommercialSnapshot;
const DEV_PENDING_PROOF: ProducerPendingPaymentProof = {
  proofId: DEV_PROOF_ID,
  purchaseId: "00000000-0000-4000-8000-000000000004",
  purchaseRequestId: DEV_REQUEST_ID,
  installmentId: "00000000-0000-4000-8000-000000000005",
  installmentPosition: 1,
  installmentAmountCents: 120_000,
  refNumber: "SK-7F3QK2",
  artistName: "Maya Cohen",
  projectId: "00000000-0000-4000-8000-000000000006",
  projectTitle: "Maya — debut single",
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
    lifecycleStatus: "active",
    workflowStage: "production",
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
    canPermanentlyDelete: false,
  },
  {
    id: "project-maya",
    title: "Debut single",
    lifecycleStatus: "waiting_for_payment",
    workflowStage: "brief",
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
    canPermanentlyDelete: false,
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
  canPermanentlyDelete: false,
  linkState: "active",
  joinedAtIso: "2026-05-18T07:00:00.000Z",
  lifetime: 150_000,
  outstanding: 0,
  activeProjects: 2,
  moneyHasMultipleCurrencies: true,
  moneyHasNoPurchases: false,
  currency: "ILS",
} satisfies ClientSpaceHeroData;

const DEV_EMPTY_CLIENT_HERO = {
  ...DEV_CLIENT_HERO,
  id: "client-empty-draft",
  name: "New Client Draft",
  email: null,
  phone: null,
  notes: null,
  tags: [],
  archived: false,
  archiveBlockedReason: null,
  canPermanentlyDelete: true,
  linkState: "none",
  lifetime: 0,
  outstanding: 0,
  activeProjects: 0,
  moneyHasMultipleCurrencies: false,
  moneyHasNoPurchases: true,
} satisfies ClientSpaceHeroData;

const DEV_ARCHIVED_CLIENT_HERO = {
  ...DEV_CLIENT_HERO,
  id: "client-archived",
  name: "Archived Artist",
  archived: true,
  archiveBlockedReason: null,
  canPermanentlyDelete: false,
  activeProjects: 0,
  moneyHasMultipleCurrencies: false,
} satisfies ClientSpaceHeroData;

function ProjectSpaceDevPreview({
  firstUpload = false,
  lifecycleStatus,
  purchaseLifecycleStatus,
}: {
  firstUpload?: boolean;
  lifecycleStatus: "active" | "completed" | "canceled";
  purchaseLifecycleStatus?: "active" | "canceled";
}) {
  return (
    <main id="main-content" tabIndex={-1} className="mx-auto max-w-[1400px] px-4 py-5 sm:px-6">
      <SongSpace
        mode="single"
        song={{
          id: "song-lior",
          purchaseId: "purchase-lior",
          title: "Midnight Drive",
          archivedAtIso: null,
          currentVersion: firstUpload ? "No audio" : "v3",
          noteCount: firstUpload ? 0 : 2,
          durationMs: firstUpload ? null : 193_000,
          workflowStage: "mixing",
          progress: 62,
          deadline: "Jul 28",
          isOverdue: false,
          revisionCount: firstUpload ? 0 : 2,
          publicExposure: "link_and_portfolio",
        }}
        project={{ id: "project-lior", name: "Full production" }}
        actionProject={{
          id: "project-lior",
          title: "Full production",
          clientName: "Lior Tansky",
          lifecycleStatus,
          workflowStage: "production",
          deadlineAtIso: "2026-07-28T12:00:00.000Z",
          canDeleteEmptyDraft: false,
        }}
        purchases={[
          {
            id: "purchase-lior",
            sourceKind: "store_product",
            sourceLabel: "Full production",
            lifecycleStatus:
              purchaseLifecycleStatus ?? (lifecycleStatus === "canceled" ? "canceled" : "active"),
            totalCents: 150_000,
            currency: "ILS",
            installments: [],
          },
        ]}
        client={{
          id: "client-lior",
          name: "Lior Tansky",
          email: "lior@example.com",
          linkState: "active",
        }}
        versions={[]}
        sessions={[]}
        gradientToken={deriveGradient("Midnight Drive")}
        initialUploadOpen={firstUpload}
      />
    </main>
  );
}

function ArtistArchivedProjectDevPreview({
  lifecycleStatus,
}: {
  lifecycleStatus: "completed" | "canceled";
}) {
  return (
    <main id="main-content" tabIndex={-1} className="mx-auto max-w-[1180px] px-4 py-5 sm:px-7">
      <ProjectPage
        role="artist"
        data={{
          project: {
            id: "project-lior",
            title: "Full production",
            clientName: "Lior Tansky",
            createdAtIso: "2026-05-18T07:00:00.000Z",
            lifecycleStatus,
          },
          tracks: [
            {
              id: "version-midnight-drive-v3",
              trackId: "song-lior",
              title: "Midnight Drive",
              artist: "Lior Tansky",
              archivedAtIso: null,
              versionLabel: "v3",
              audioUrl: "/icon",
              durationMs: 193_000,
              uploadedAtIso: "2026-07-14T07:00:00.000Z",
              unreadComments: 2,
              plays: 0,
            },
          ],
        }}
      />
    </main>
  );
}

const DEV_ARTIST_LIBRARY_TRACKS = [
  {
    id: "version-active-v2",
    trackId: "track-active",
    trackTitle: "Neon Morning",
    trackArtist: "Maya Cohen",
    archivedAtIso: null,
    label: "v2",
    projectId: "project-active",
    projectTitle: "Active single",
    projectLifecycleStatus: "active",
    clientName: "Skitza Studio",
    uploadedAtIso: "2026-07-16T07:00:00.000Z",
    audioUrl: "/icon",
    durationMs: 188_000,
    unreadComments: 1,
    plays: 6,
  },
  {
    id: "version-completed-v4",
    trackId: "track-completed",
    trackTitle: "Afterlight",
    trackArtist: "Maya Cohen",
    archivedAtIso: null,
    label: "v4",
    projectId: "project-completed",
    projectTitle: "Completed EP",
    projectLifecycleStatus: "completed",
    clientName: "Skitza Studio",
    uploadedAtIso: "2026-06-12T07:00:00.000Z",
    audioUrl: "/icon",
    durationMs: 214_000,
    unreadComments: 0,
    plays: 19,
  },
] satisfies MusicLibraryRow[];

const DEV_ARTIST_LIBRARY_PROJECTS = [
  {
    id: "project-active",
    title: "Active single",
    artistLabel: "Skitza Studio",
    trackCount: 1,
    projectLifecycleStatus: "active",
    latestTrackUploadedAtIso: "2026-07-16T07:00:00.000Z",
  },
  {
    id: "project-completed",
    title: "Completed EP",
    artistLabel: "Skitza Studio",
    trackCount: 1,
    projectLifecycleStatus: "completed",
    latestTrackUploadedAtIso: "2026-06-12T07:00:00.000Z",
  },
  {
    id: "project-canceled-empty",
    title: "Canceled album draft",
    artistLabel: "Skitza Studio",
    trackCount: 0,
    projectLifecycleStatus: "canceled",
    latestTrackUploadedAtIso: null,
  },
] satisfies MusicLibraryProjectRow[];

function ArtistLibraryLifecycleDevPreview() {
  return (
    <main id="main-content" tabIndex={-1} className="mx-auto max-w-[1180px] px-4 py-5 sm:px-7">
      <MusicLibraryScreen
        tracks={DEV_ARTIST_LIBRARY_TRACKS}
        projectRows={DEV_ARTIST_LIBRARY_PROJECTS}
        role="artist"
      />
    </main>
  );
}

const DEV_SK8_LIBRARY_TRACKS = [
  {
    id: "version-sk8-live-v3",
    latestVersionId: "version-sk8-live-v3",
    trackId: "track-sk8-live",
    trackTitle: "After the Rain",
    trackArtist: "Noya Halevi",
    archivedAtIso: null,
    releasedAtIso: "2026-07-18T12:00:00.000Z",
    audioDeletedAtIso: null,
    label: "Final master",
    projectId: "project-sk8-live",
    projectTitle: "After the Rain — Single",
    projectLifecycleStatus: "active",
    clientName: "Noya Halevi",
    uploadedAtIso: "2026-07-18T09:30:00.000Z",
    audioUrl: "/icon",
    durationMs: 201_000,
    unreadComments: 3,
    plays: 18,
    actionHref: "/dev/screens/sk8-library",
  },
  {
    id: "version-sk8-history-v4",
    latestVersionId: "version-sk8-history-v4",
    trackId: "track-sk8-history",
    trackTitle: "Paper Planes",
    trackArtist: "Ari Cohen",
    archivedAtIso: null,
    releasedAtIso: "2026-07-17T12:00:00.000Z",
    audioDeletedAtIso: "2026-07-18T11:00:00.000Z",
    label: "v4 · audio deleted",
    projectId: "project-sk8-history",
    projectTitle: "Paper Planes — Single",
    projectLifecycleStatus: "active",
    clientName: "Ari Cohen",
    uploadedAtIso: "2026-07-16T13:10:00.000Z",
    audioUrl: null,
    durationMs: null,
    unreadComments: 1,
    plays: 7,
    actionHref: "/dev/screens/sk8-library",
  },
  {
    id: "version-sk8-archived-v2",
    latestVersionId: "version-sk8-archived-v2",
    trackId: "track-sk8-archived",
    trackTitle: "Slow Motion",
    trackArtist: "Maya Cohen",
    archivedAtIso: "2026-07-10T10:00:00.000Z",
    releasedAtIso: null,
    audioDeletedAtIso: null,
    label: "v2",
    projectId: "project-sk8-archived",
    projectTitle: "Slow Motion — Single",
    projectLifecycleStatus: "active",
    clientName: "Maya Cohen",
    uploadedAtIso: "2026-07-10T09:40:00.000Z",
    audioUrl: "/icon",
    durationMs: 184_000,
    unreadComments: 0,
    plays: 12,
    actionHref: null,
  },
] satisfies MusicLibraryRow[];

function Sk8LibraryDevPreview() {
  return <Sk8LibraryDevScreen tracks={DEV_SK8_LIBRARY_TRACKS} />;
}

function Sk8SongDevPreview({
  archived,
  role = "producer",
}: {
  archived: boolean;
  role?: "producer" | "artist";
}) {
  return <Sk8SongDevScreen archived={archived} role={role} />;
}

function Sk94ApprovalDevPreview({
  role,
  state,
}: {
  role: "producer" | "artist";
  state: "ready" | "approved" | "reopened";
}) {
  return <Sk94ApprovalDevScreen role={role} state={state} />;
}

function Sk72RequestDevPreview({ state }: { state: "pending" | "approved" | "accepted" }) {
  const accepted = state === "accepted";
  const commercialTerms = accepted
    ? ({
        kind: "accepted",
        purchaseId: "00000000-0000-4000-8000-000000000004",
        acceptedAt: new Date("2026-07-20T09:30:00.000Z"),
        snapshot: DEV_SK72_COMMERCIAL_SNAPSHOT,
      } as const)
    : ({
        kind: "proposal",
        snapshot: {
          ...DEV_SK72_COMMERCIAL_SNAPSHOT,
          selectedPaymentPlan: null,
          agreementText:
            "Exact proposed production agreement for three songs.\nPayment plan: Not selected yet.\nThe artist chooses an enabled plan and accepts the exact agreement only after producer approval.",
        },
      } as const);

  return (
    <main className="mx-auto w-full max-w-[720px] px-4 py-6 sm:px-6 sm:py-10">
      <header className="border-b border-[rgb(var(--border-subtle))] pb-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="font-mono text-[11px] font-semibold tracking-[0.14em] text-[rgb(var(--fg-muted))] uppercase">
            SK-72QA
          </p>
          <span className="rounded-[var(--radius-sm)] bg-[rgb(var(--bg-sunken))] px-2.5 py-1 text-xs font-semibold text-[rgb(var(--fg-secondary))] capitalize">
            {accepted ? "Accepted" : state}
          </span>
        </div>
        <h1 className="font-display mt-3 text-[clamp(1.75rem,4vw,2.5rem)] leading-tight font-extrabold tracking-[-0.035em] break-words text-[rgb(var(--fg-default))]">
          {DEV_SK72_COMMERCIAL_SNAPSHOT.productOrOfferName}
        </h1>
        <p className="mt-2 text-sm break-words text-[rgb(var(--fg-secondary))]">
          Requested by Maya Cohen · maya.long.email@example.invalid
        </p>
        <p className="font-display mt-4 text-2xl font-extrabold text-[rgb(var(--fg-default))] tabular-nums">
          ₪2,832
        </p>
      </header>

      {!accepted ? (
        <PurchaseRequestReview
          id={DEV_REQUEST_ID}
          initialStatus={state}
          initialUndoableUntilIso={state === "approved" ? "2099-07-20T09:35:00.000Z" : null}
          initialProjectId={null}
          targetProjects={[]}
        />
      ) : null}

      <PurchaseRequestCommercialDetails
        commercialTerms={commercialTerms}
        brief="Keep the lead vocal intimate and leave space for a live string overdub."
        submittedAt={new Date("2026-07-20T08:00:00.000Z")}
      />
    </main>
  );
}

// Dev-only screen gallery for the handoff-4 wave (2026-07-05). Renders the
// funnel screens with mock props at /dev/screens/<name> so visual QA can
// screenshot every state at 390×844 WITHOUT a Clerk session. Hard 404 in
// Vercel Production. Local development and Vercel Preview stay available for
// approval without Clerk or database state.
type Params = { params: Promise<{ screen: string }> };

function withArtistPlatformStandingChrome(screen: string, children: ReactNode) {
  const state = findArtistPlatformPreviewState(screen);
  if (!state || state.chrome !== "Standing") {
    throw new Error(`Missing standing artist preview contract for ${screen}`);
  }

  return (
    <ArtistPlatformPreviewShell
      activeDestination={state.activeDestination}
      screenLabel={state.label}
    >
      {children}
    </ArtistPlatformPreviewShell>
  );
}

export default async function DevScreenPage({ params }: Params) {
  if (!isDevGalleryAvailable()) notFound();
  const { screen } = await params;

  switch (screen) {
    case "artist-home":
      return withArtistPlatformStandingChrome(screen, <ArtistHomeDevPreview />);
    case "artist-store":
      return withArtistPlatformStandingChrome(screen, <ArtistStoreCatalogDevPreview />);
    case "artist-sessions":
      return withArtistPlatformStandingChrome(screen, <ArtistSessionsHubDevPreview />);
    case "artist-session-detail":
      return withArtistPlatformStandingChrome(screen, <ArtistSessionDetailDevPreview />);
    case "artist-settings":
      return withArtistPlatformStandingChrome(screen, <ArtistSettingsDevPreview />);
    case "artist-notifications":
      return withArtistPlatformStandingChrome(screen, <ArtistNotificationCenterDevPreview />);
    case "s3":
      return withArtistPlatformStandingChrome(
        screen,
        <ProfessionalProductDetail
          product={MOCK_PRODUCT}
          studioId={DEV_ARTIST_STUDIO_ID}
          activePurchase={null}
          requestHrefOverride="/dev/screens/s3-request"
        />,
      );
    case "s3-pending":
      return withArtistPlatformStandingChrome(
        screen,
        <ProfessionalProductDetail
          product={MOCK_PRODUCT}
          studioId={DEV_ARTIST_STUDIO_ID}
          activePurchase={{
            href: "/dev/screens/s5",
            label: "Request awaiting review",
          }}
        />,
      );
    case "s3-request":
      return (
        <PurchaseRequestScreen
          productId={MOCK_PRODUCT.id}
          productName={MOCK_PRODUCT.name}
          producerName={MOCK_PRODUCER.name}
          studioId={DEV_ARTIST_STUDIO_ID}
          amountCents={MOCK_PRODUCT.priceCents}
          currency={MOCK_PRODUCT.currency}
          targetProjects={[]}
          previewSentHref="/dev/screens/s5"
          backHrefOverride="/dev/screens/s3"
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
      return <RequestSentScreen producer={MOCK_PRODUCER} requestRef="SK-7F3QK2" />;
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
          producerName={MOCK_PRODUCER.name}
          amountDueNowCents={120000}
          currency={MOCK_PRODUCT.currency}
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
      return (
        <UploadProofScreen
          productName={MOCK_PRODUCT.name}
          producerName={MOCK_PRODUCER.name}
          previewOnly
          currency="ILS"
          installmentPosition={1}
          thisProofCents={120_000}
          backHref="/dev/screens/s8"
        />
      );
    case "s9-awaiting":
      return withArtistPlatformStandingChrome(
        screen,
        <ProofRecordScreen
          purchaseId={DEV_ARTIST_PURCHASE_ID}
          studioId={DEV_ARTIST_STUDIO_ID}
          productName={MOCK_PRODUCT.name}
          producerName={MOCK_PRODUCER.name}
          currency="ILS"
          proof={DEV_ARTIST_PENDING_PROOF}
          remainingCents={240_000}
          paidInFull={false}
          replacementUploadAvailable={false}
          history={[DEV_ARTIST_PENDING_PROOF]}
          evidenceUrl="#proof-preview"
          rejectionNote={null}
        />,
      );
    case "s9-rejected":
      return withArtistPlatformStandingChrome(
        screen,
        <ProofRecordScreen
          purchaseId={DEV_ARTIST_PURCHASE_ID}
          studioId={DEV_ARTIST_STUDIO_ID}
          productName={MOCK_PRODUCT.name}
          producerName={MOCK_PRODUCER.name}
          currency="ILS"
          proof={DEV_ARTIST_REJECTED_PROOF}
          remainingCents={240_000}
          paidInFull={false}
          replacementUploadAvailable
          history={[DEV_ARTIST_REJECTED_PROOF]}
          evidenceUrl="#proof-preview"
          rejectionNote="The amount is cut off in the screenshot."
        />,
      );
    case "s9-partial":
      return withArtistPlatformStandingChrome(
        screen,
        <PaymentSummaryScreen
          purchaseId={DEV_ARTIST_PURCHASE_ID}
          studioId={DEV_ARTIST_STUDIO_ID}
          productName={MOCK_PRODUCT.name}
          producerName={MOCK_PRODUCER.name}
          currency="ILS"
          totalCents={240_000}
          verifiedCents={120_000}
          remainingCents={120_000}
          currentInstallmentPosition={2}
          paymentInstructionsAvailable
          proofs={[DEV_ARTIST_CONFIRMED_PROOF]}
        />,
      );
    case "s9-paid":
      return withArtistPlatformStandingChrome(
        screen,
        <PaymentSummaryScreen
          purchaseId={DEV_ARTIST_PURCHASE_ID}
          studioId={DEV_ARTIST_STUDIO_ID}
          productName={MOCK_PRODUCT.name}
          producerName={MOCK_PRODUCER.name}
          currency="ILS"
          totalCents={240_000}
          verifiedCents={240_000}
          remainingCents={0}
          currentInstallmentPosition={2}
          paymentInstructionsAvailable
          proofs={[DEV_ARTIST_CONFIRMED_PROOF, DEV_ARTIST_FINAL_PROOF]}
        />,
      );
    case "sk72-request-pending":
      return <Sk72RequestDevPreview state="pending" />;
    case "sk72-request-approved":
      return <Sk72RequestDevPreview state="approved" />;
    case "sk72-request-accepted":
      return <Sk72RequestDevPreview state="accepted" />;
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
    case "client-space-empty":
      return (
        <main
          id="main-content"
          tabIndex={-1}
          className="mx-auto max-w-[1400px] px-4 py-5 sm:px-6 lg:px-8"
        >
          <ClientSpaceHero client={DEV_EMPTY_CLIENT_HERO} producerSlug="gili" />
        </main>
      );
    case "client-space-archived":
      return (
        <main
          id="main-content"
          tabIndex={-1}
          className="mx-auto max-w-[1400px] px-4 py-5 sm:px-6 lg:px-8"
        >
          <ClientSpaceHero client={DEV_ARCHIVED_CLIENT_HERO} producerSlug="gili" />
        </main>
      );
    case "project-space":
      return <ProjectSpaceDevPreview lifecycleStatus="active" />;
    case "sk121-first-song-upload":
      return <ProjectSpaceDevPreview firstUpload lifecycleStatus="active" />;
    case "project-space-completed":
      return <ProjectSpaceDevPreview lifecycleStatus="completed" />;
    case "project-space-canceled":
      return <ProjectSpaceDevPreview lifecycleStatus="canceled" />;
    case "project-space-reopened-canceled-purchase":
      return <ProjectSpaceDevPreview lifecycleStatus="active" purchaseLifecycleStatus="canceled" />;
    case "artist-project-completed":
      return withArtistPlatformStandingChrome(
        screen,
        <ArtistArchivedProjectDevPreview lifecycleStatus="completed" />,
      );
    case "artist-project-canceled":
      return withArtistPlatformStandingChrome(
        screen,
        <ArtistArchivedProjectDevPreview lifecycleStatus="canceled" />,
      );
    case "artist-library-lifecycle":
      return withArtistPlatformStandingChrome(screen, <ArtistLibraryLifecycleDevPreview />);
    case "sk8-library":
      return <Sk8LibraryDevPreview />;
    case "sk8-song":
      return <Sk8SongDevPreview archived={false} />;
    case "sk8-song-archived":
      return <Sk8SongDevPreview archived />;
    case "sk98-artist-song":
      return <Sk8SongDevPreview archived={false} role="artist" />;
    case "sk98-public-song":
      return (
        <PublicSongPlayer
          songTitle="Neon Afterglow"
          artist="Maya Cohen"
          producerName="Studio Gili"
          producerLogoUrl={null}
          versions={[
            {
              id: "00000000-0000-4000-8000-000000000103",
              label: "Final master",
              audioUrl: "/icon",
              durationMs: 214_000,
              uploadedAtIso: "2026-07-20T12:00:00.000Z",
              peaks: [0.18, 0.42, 0.76, 0.51, 0.9, 0.62, 0.35, 0.71],
            },
            {
              id: "00000000-0000-4000-8000-000000000102",
              label: "Mix v2",
              audioUrl: "/icon",
              durationMs: 212_000,
              uploadedAtIso: "2026-07-18T15:00:00.000Z",
              peaks: [0.12, 0.36, 0.65, 0.44, 0.81, 0.57, 0.3, 0.63],
            },
          ]}
        />
      );
    case "sk94-producer-approved":
      return <Sk94ApprovalDevPreview role="producer" state="approved" />;
    case "sk94-producer-reopened":
      return <Sk94ApprovalDevPreview role="producer" state="reopened" />;
    case "sk94-artist-ready":
      return <Sk94ApprovalDevPreview role="artist" state="ready" />;
    case "sk94-artist-approved":
      return <Sk94ApprovalDevPreview role="artist" state="approved" />;
    case "add-song":
      return <UploadModalDevScreen />;
    case "gate2-queue":
      return (
        <main className="mx-auto w-full max-w-[1040px] px-4 py-8 sm:px-6 lg:px-8">
          <PaymentProofList
            title="Needs review"
            eyebrow="1 waiting"
            proofs={[DEV_PENDING_PROOF]}
            emptyCopy="No payment proofs need review."
          />
        </main>
      );
    case "gate2-review": {
      const proof = {
        ...DEV_PENDING_PROOF,
        status: "pending" as const,
        rejectionNote: null,
        confirmedAt: null,
        rejectedAt: null,
      };
      return (
        <main className="mx-auto w-full max-w-[1040px] px-4 py-8 sm:px-6 lg:px-8">
          <PaymentProofReview
            review={{
              proof,
              evidenceUrl: "/icon",
              evidenceExpiresInSeconds: 300,
              history: [proof],
            }}
          />
        </main>
      );
    }
    case "sk75-proof-flow":
      return <Sk75ProofFlowDevScreen />;
    case "sk69-payments-flow":
      return <Sk69PaymentsDevScreen />;
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
              currency={MOCK_PRODUCT.currency}
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
