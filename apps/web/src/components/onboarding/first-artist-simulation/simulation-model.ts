// "Watch your first artist" (SK-298, reel since SK-310) — pure model for the
// render-only reel shown right after a producer publishes their page.
//
// Everything here is derived from the producer's REAL first product plus one
// fictional artist. Nothing is persisted: the overlay renders the live artist
// and producer screens with these props and never calls a mutation.

import type { PaymentPlan, ProductRoyaltyTerms, PurchaseCommercialSnapshot } from "@skitza/db";

import {
  livePlanOptions,
  paymentPlanLabel,
  type LivePaymentPlanChoice,
  type LivePlanOption,
} from "~/components/artist/purchase/pay-data";
import type { PaymentDetails } from "~/components/artist/purchase/payment-instructions-screen";
import type { Producer, PurchaseProduct } from "~/components/artist/purchase/purchase-data";
import type { AllowanceSummary, SessionListItem } from "~/components/artist/sessions/book-data";
import type { VersionDeliveryState } from "~/components/music/delivery-state";
import type { MusicLibraryTrackRow } from "~/components/music/library-screen";
import type { SongPageData } from "~/components/music/song-page";
import { producerHue, producerInitials } from "~/lib/_phase4-stubs/producer-color";
import { formatMoney } from "~/lib/format/money";
import type { VolumeTier } from "~/lib/pricing";
import { durationLabel } from "~/lib/purchase/product-mapping";
import { applyTaxToCents, type TaxMode } from "~/lib/tax-mode";
import type { ProducerPaymentProofReview } from "~/server/domain/payment-proofs/service";

export const SIMULATED_ARTIST = {
  name: "Noya Levi",
  firstName: "Noya",
  projectTitle: "Blue Hour",
  proofFileName: "bit-transfer.png",
} as const;

/** Shown on every screen. Tests pin the exact wording. */
export const SIMULATION_LABEL = "Example · Noya is not a real artist";

// Deterministic, obviously-fake identifiers. They never reach the database;
// they exist because the reused screens require ids for keys and labels.
export const SIMULATION_IDS = {
  purchase: "00000000-0000-4000-8000-00000000s298",
  purchaseRequest: "00000000-0000-4000-8000-00000000s299",
  installment: "00000000-0000-4000-8000-00000000s300",
  proof: "00000000-0000-4000-8000-00000000s301",
  project: "00000000-0000-4000-8000-00000000s302",
  allowance: "00000000-0000-4000-8000-00000000s303",
  session: "00000000-0000-4000-8000-00000000s304",
  track: "00000000-0000-4000-8000-00000000s305",
  versionOne: "00000000-0000-4000-8000-00000000s306",
  versionTwo: "00000000-0000-4000-8000-00000000s307",
  commentOne: "00000000-0000-4000-8000-00000000s308",
  commentTwo: "00000000-0000-4000-8000-00000000s309",
  trackTwo: "00000000-0000-4000-8000-00000000s310",
  trackThree: "00000000-0000-4000-8000-00000000s311",
  versionThree: "00000000-0000-4000-8000-00000000s312",
  versionFour: "00000000-0000-4000-8000-00000000s313",
  projectTwo: "00000000-0000-4000-8000-00000000s314",
  projectThree: "00000000-0000-4000-8000-00000000s315",
  studio: "simulation-studio",
  requestRef: "SK-SIM298",
} as const;

/** Every link inside the simulation points here; the frames never navigate. */
export const SIMULATION_INERT_HREF = "#simulation";

export interface SimulationProduct {
  id: string;
  name: string;
  tagline: string;
  priceCents: number;
  currency: string;
  pricingModel: "flat" | "per_song";
  volumeTiers: VolumeTier[];
  durationMin: number;
  sessionCount: number;
  deliverables: string[];
  revisions: number;
  unlimitedRevisions: boolean;
  paymentPlans: PaymentPlan[];
  royaltyTerms: ProductRoyaltyTerms | null;
  agreementText: string;
}

export interface SimulationInput {
  producerName: string;
  producerLogoUrl: string | null;
  /** The studio's IANA time zone; the booked session is shown in it. */
  timezone: string;
  product: SimulationProduct;
  taxMode: TaxMode;
  taxRatePct: number;
  /** The producer's own bank/Bit details when already saved; null shows an example. */
  paymentDetails: PaymentDetails | null;
}

export type SimulationSceneId = "hook" | "link" | "booking" | "library" | "money" | "studio";

/** Whose screen the scene plays on; the hook is an illustration with no screen. */
export type SimulationSide = "hook" | "artist" | "producer";

/**
 * One screen of the reel. The copy budget is deliberate: a headline of two
 * to five words and one line under ten, no idioms, digits not words, so a
 * non-native reader gets it at a glance. The model test counts the words.
 */
export interface SimulationScene {
  id: SimulationSceneId;
  side: SimulationSide;
  /** 1-based position in the reel. */
  step: number;
  headline: string;
  line: string;
  /** How long autoplay holds the scene, including its payoff. */
  durationMs: number;
}

export interface SimulationModel {
  producer: Producer;
  producerLogoUrl: string | null;
  product: PurchaseProduct;
  taxMode: TaxMode;
  taxRatePct: number;
  /** Total the artist agrees to, after the producer's tax mode. */
  totalCents: number;
  currency: string;
  planOptions: LivePlanOption[];
  selectedPlan: LivePaymentPlanChoice;
  /** The offered plans with the story's plan first, for screens that read the first plan. */
  storyPlans: PaymentPlan[];
  planLabel: string;
  /** First installment, exactly as the server schedule would freeze it. */
  dueNowCents: number;
  /** Remaining balance after the first installment. */
  remainingCents: number;
  /** Trigger of the last installment, phrased for the outcome card. */
  finalPaymentTrigger: "none" | "artist_approval" | "monthly";
  paymentDetails: PaymentDetails;
  paymentDetailsAreExample: boolean;
  proofReview: ProducerPaymentProofReview;
  /** The product carries studio time, so the artist can book her own session. */
  includesStudioTime: boolean;
  song: SimulationSong;
  booking: SimulationBooking;
  session: SimulationSession;
  dashboard: SimulationDashboard;
  request: SimulationRequest;
  /** Her library: Blue Hour plus two more demos, in the live song-row shape. */
  library: MusicLibraryTrackRow[];
  scenes: readonly SimulationScene[];
}

/** Her song, before and after she approves the exact version. */
export interface SimulationSong {
  data: SongPageData;
  approved: SongPageData;
}

/** Props for the live artist booking screen, before she picks a time. */
export interface SimulationBooking {
  availability: {
    days: { date: string; slots: SimulationSlot[] }[];
    artistTimeZone: string;
    studioTimeZone: string;
    today: string;
  };
  studios: { producerId: string; name: string; slug: string; logoUrl: string | null }[];
  activePackages: SimulationActivePackage[];
  allowanceId: string;
}

export interface SimulationSlot {
  startsAtISO: string;
  endsAtISO: string;
  studioDate: string;
  studioStartMin: number;
}

export interface SimulationActivePackage {
  purchaseId: string;
  sessionAllowanceId: string;
  projectId: string;
  title: string;
  packageName: string;
  sessionCount: number;
  sessionsUsed: number;
  sessionsRemaining: number;
  unlimitedSessions: boolean;
  durationMin: number;
  locationType: string;
  bufferMinutes: number;
  minLeadHours: number;
  autoConfirm: boolean;
}

/** The session after she books it, for the live confirmation and list screens. */
export interface SimulationSession {
  item: SessionListItem;
  allowance: AllowanceSummary;
  nowISO: string;
}

/** Props for the live producer overview once the project is running. */
export interface SimulationDashboard {
  now: Date;
  pulseStats: {
    commercialAvailable: boolean;
    thisMonthCents: number | null;
    outstandingCents: number | null;
    currency: string | null;
    activeProjects: number;
  };
  todaySession: {
    id: string;
    title: string;
    subtitle: string;
    occurredAt: Date;
    href: string;
  } | null;
  recentUploads: {
    versionId: string;
    trackId: string;
    title: string;
    versionLabel: string;
    uploadedAt: Date;
    durationMs: number | null;
    projectId: string;
    projectClientName: string;
  }[];
  paymentBalances: {
    purchaseId: string;
    projectId: string;
    projectTitle: string;
    clientName: string;
    purchaseTitle: string;
  }[];
}

/** Her request to book, as the producer's own review screen reads it. */
export interface SimulationRequest {
  snapshot: PurchaseCommercialSnapshot;
  submittedAtLabel: string;
  totalLabel: string;
  brief: string;
  artistEmail: string;
}

const EXAMPLE_PAYMENT_DETAILS: PaymentDetails = {
  bankTransfer: "Example bank\nBranch 000\nAccount 00-000000",
  bitPhone: "050-000-0000",
  note: "Example only. Your real bank or Bit details appear here once you add them.",
};

/**
 * Mirrors `createInstallmentSchedule` in `server/domain/purchases/ledger.ts`
 * (kept pure here so the client bundle never imports server code; the model
 * test asserts both stay identical).
 */
export function simulatedCharges(plan: LivePaymentPlanChoice, totalCents: number): number[] {
  if (totalCents <= 0) return [];
  switch (plan.kind) {
    case "full":
      return [totalCents];
    case "split_50_50": {
      const second = Math.floor(totalCents / 2);
      return [totalCents - second, second];
    }
    case "monthly": {
      const base = Math.floor(totalCents / plan.installments);
      const remainder = totalCents - base * plan.installments;
      return Array.from({ length: plan.installments }, (_, index) =>
        index === 0 ? base + remainder : base,
      );
    }
  }
}

function toPlanChoice(plan: PaymentPlan): LivePaymentPlanChoice | null {
  if (plan.kind === "full" || plan.kind === "split_50_50") return { kind: plan.kind };
  const installments = Math.round(plan.installments);
  if (!Number.isInteger(installments) || installments < 2 || installments > 12) return null;
  return { kind: "monthly", installments };
}

function offeredPlans(plans: readonly PaymentPlan[]): LivePaymentPlanChoice[] {
  const choices: LivePaymentPlanChoice[] = [];
  for (const plan of plans) {
    const choice = toPlanChoice(plan);
    if (!choice) continue;
    const duplicate = choices.some((existing) =>
      existing.kind === "monthly" && choice.kind === "monthly"
        ? existing.installments === choice.installments
        : existing.kind === choice.kind,
    );
    if (!duplicate) choices.push(choice);
  }
  return choices.length > 0 ? choices : [{ kind: "full" }];
}

/** The story prefers 50/50 (it shows approval-gated money), then full, then monthly. */
export function chooseStoryPlan(plans: readonly LivePaymentPlanChoice[]): LivePaymentPlanChoice {
  return (
    plans.find((plan) => plan.kind === "split_50_50") ??
    plans.find((plan) => plan.kind === "full") ??
    plans[0] ?? { kind: "full" }
  );
}

export function toSimulationPurchaseProduct(product: SimulationProduct): PurchaseProduct {
  return {
    id: product.id,
    name: product.name,
    priceCents: product.priceCents,
    currency: product.currency,
    durationLabel: durationLabel(product.sessionCount, product.durationMin),
    includes: [...product.deliverables],
    tagline: product.tagline.trim() ? product.tagline : null,
    sessions: product.sessionCount,
    unlimitedSessions: product.durationMin > 0 && product.sessionCount === 0,
    revisions: product.revisions,
    unlimitedRevisions: product.unlimitedRevisions,
    paymentPlans: [...product.paymentPlans],
    royaltyTerms: product.royaltyTerms,
    agreementText: product.agreementText.trim() ? product.agreementText : null,
    pricingModel: product.pricingModel,
    volumeTiers: [...product.volumeTiers],
  };
}

function svgReceipt(input: {
  producerName: string;
  amountLabel: string;
  reference: string;
}): string {
  const escape = (value: string) =>
    value
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="720" height="960" viewBox="0 0 720 960">
<rect width="720" height="960" fill="#F2EDE6"/>
<rect x="60" y="80" width="600" height="800" rx="36" fill="#FFFFFF" stroke="#E8E1D4" stroke-width="3"/>
<circle cx="360" cy="240" r="64" fill="#D4960A"/>
<path d="M330 242 l20 20 l40 -48" fill="none" stroke="#111009" stroke-width="12" stroke-linecap="round" stroke-linejoin="round"/>
<text x="360" y="360" text-anchor="middle" font-family="system-ui, sans-serif" font-size="30" fill="#6B6359">Transfer complete</text>
<text x="360" y="440" text-anchor="middle" font-family="system-ui, sans-serif" font-size="64" font-weight="700" fill="#111009">${escape(input.amountLabel)}</text>
<text x="360" y="520" text-anchor="middle" font-family="system-ui, sans-serif" font-size="28" fill="#3D3730">To ${escape(input.producerName)}</text>
<text x="360" y="600" text-anchor="middle" font-family="ui-monospace, monospace" font-size="24" fill="#6B6359">Ref ${escape(input.reference)}</text>
<text x="360" y="780" text-anchor="middle" font-family="system-ui, sans-serif" font-size="22" fill="#A17106">Example receipt · simulation</text>
</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/** Her song runs 3:18, long enough for a comment at 0:42 to sit mid-wave. */
const SONG_DURATION_MS = 198_000;
/** The hour the story books, in the studio's own time zone. */
const SESSION_HOUR = 14;
/** Israel's weekend. Skitza's studios are Israeli, so the story avoids it. */
const WEEKEND_DAYS = new Set(["Fri", "Sat"]);
/**
 * A 44-byte silent WAV. The song frame needs a non-null audio URL to look
 * playable, and a data URL keeps the simulation completely off the network.
 * The waveform itself is drawn from `peaks`, never decoded from this.
 */
const SILENT_AUDIO_DATA_URL =
  "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAgD4AAAB9AAACABAAZGF0YQAAAAA=";

/**
 * A stable, envelope-shaped waveform. Same generator as the development
 * gallery (`components/dev/sk8-music-dev-screen.tsx`) so the simulated song
 * looks exactly like a real upload without decoding any audio.
 */
export function previewPeaks(offset: number): number[] {
  return Array.from({ length: 200 }, (_, index) => {
    const envelope = 0.22 + Math.abs(Math.sin((index + offset) * 0.12)) * 0.62;
    const detail = Math.sin((index + offset) * 0.47) * 0.12;
    return Math.min(1, Math.max(0.08, Number((envelope + detail).toFixed(3))));
  });
}

interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: string;
}

function zonedParts(instant: Date, timeZone: string): ZonedParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);
  const read = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? "";
  return {
    year: Number(read("year")),
    month: Number(read("month")),
    day: Number(read("day")),
    // Intl renders midnight as hour 24 under hour12: false in some engines.
    hour: Number(read("hour")) % 24,
    minute: Number(read("minute")),
    second: Number(read("second")),
    weekday: read("weekday"),
  };
}

function zoneOffsetMs(instant: Date, timeZone: string): number {
  const parts = zonedParts(instant, timeZone);
  const asUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  return asUtc - (instant.getTime() - instant.getUTCMilliseconds());
}

export interface CivilDate {
  year: number;
  month: number;
  day: number;
}

/** The instant whose wall clock in `timeZone` is exactly this date and time. */
export function zonedInstant(input: CivilDate & { hour: number; timeZone: string }): Date {
  const naive = Date.UTC(input.year, input.month - 1, input.day, input.hour, 0, 0);
  const firstPass = new Date(naive - zoneOffsetMs(new Date(naive), input.timeZone));
  // A second pass settles the daylight-saving edges, where the offset that
  // applies to the answer differs from the offset at the naive guess.
  return new Date(naive - zoneOffsetMs(firstPass, input.timeZone));
}

export function civilDateKey(date: CivilDate): string {
  const pad = (value: number, size: number) => String(value).padStart(size, "0");
  return `${pad(date.year, 4)}-${pad(date.month, 2)}-${pad(date.day, 2)}`;
}

/** The next working day after `now` in the studio's zone, skipping the weekend. */
export function nextWorkingDay(now: Date, timeZone: string): CivilDate {
  for (let step = 1; step <= 7; step += 1) {
    const parts = zonedParts(new Date(now.getTime() + step * DAY_MS), timeZone);
    if (!WEEKEND_DAYS.has(parts.weekday)) {
      return { year: parts.year, month: parts.month, day: parts.day };
    }
  }
  const tomorrow = zonedParts(new Date(now.getTime() + DAY_MS), timeZone);
  return { year: tomorrow.year, month: tomorrow.month, day: tomorrow.day };
}

function workingDaysFrom(start: CivilDate, timeZone: string, count: number): CivilDate[] {
  const days: CivilDate[] = [start];
  let cursor = zonedInstant({ ...start, hour: 12, timeZone });
  while (days.length < count) {
    cursor = new Date(cursor.getTime() + DAY_MS);
    const parts = zonedParts(cursor, timeZone);
    if (WEEKEND_DAYS.has(parts.weekday)) continue;
    days.push({ year: parts.year, month: parts.month, day: parts.day });
  }
  return days;
}

function buildBooking(input: {
  producerName: string;
  producerLogoUrl: string | null;
  productName: string;
  projectTitle: string;
  sessionCount: number;
  unlimitedSessions: boolean;
  durationMin: number;
  timeZone: string;
  now: Date;
}): { booking: SimulationBooking; sessionStartsAt: Date } {
  const { timeZone, durationMin } = input;
  const first = nextWorkingDay(input.now, timeZone);
  const days = workingDaysFrom(first, timeZone, 4).map((day) => {
    const date = civilDateKey(day);
    const slots: SimulationSlot[] = [10, 12, 14, 16, 18].map((hour) => {
      const startsAt = zonedInstant({ ...day, hour, timeZone });
      return {
        startsAtISO: startsAt.toISOString(),
        endsAtISO: new Date(startsAt.getTime() + durationMin * MINUTE_MS).toISOString(),
        studioDate: date,
        studioStartMin: hour * 60,
      };
    });
    return { date, slots };
  });

  return {
    sessionStartsAt: zonedInstant({ ...first, hour: SESSION_HOUR, timeZone }),
    booking: {
      availability: {
        days,
        artistTimeZone: timeZone,
        studioTimeZone: timeZone,
        today: civilDateKey(zonedParts(input.now, timeZone)),
      },
      studios: [
        {
          producerId: SIMULATION_IDS.studio,
          name: input.producerName,
          slug: "your-studio",
          logoUrl: input.producerLogoUrl,
        },
      ],
      activePackages: [
        {
          purchaseId: SIMULATION_IDS.purchase,
          sessionAllowanceId: SIMULATION_IDS.allowance,
          projectId: SIMULATION_IDS.project,
          title: input.projectTitle,
          packageName: input.productName,
          sessionCount: input.sessionCount,
          sessionsUsed: 0,
          sessionsRemaining: input.sessionCount,
          unlimitedSessions: input.unlimitedSessions,
          durationMin,
          locationType: "studio",
          bufferMinutes: 30,
          minLeadHours: 24,
          autoConfirm: true,
        },
      ],
      allowanceId: SIMULATION_IDS.allowance,
    },
  };
}

function buildSession(input: {
  producerName: string;
  productName: string;
  projectTitle: string;
  sessionCount: number;
  unlimitedSessions: boolean;
  durationMin: number;
  timeZone: string;
  now: Date;
  startsAt: Date;
}): SimulationSession {
  const { timeZone, startsAt } = input;
  const item: SessionListItem = {
    id: SIMULATION_IDS.session,
    producerId: SIMULATION_IDS.studio,
    producerName: input.producerName,
    producerSlug: "your-studio",
    artistTimezone: timeZone,
    producerTimezone: timeZone,
    projectId: SIMULATION_IDS.project,
    projectTitle: input.projectTitle,
    purchaseId: SIMULATION_IDS.purchase,
    sessionAllowanceId: SIMULATION_IDS.allowance,
    startsAtISO: startsAt.toISOString(),
    durationMin: input.durationMin,
    packageName: input.productName,
    locationType: "studio",
    status: "confirmed",
    outcome: "reserved",
    billingTreatment: "included",
    artistRsvpStatus: "accepted",
    artistRsvpRespondedAtISO: input.now.toISOString(),
    changeRequest: null,
    rescheduledFromBookingId: null,
    heldExpiryReason: null,
    policy: {
      cancellationPolicyHours: 24,
      cancellationDeadlineISO: new Date(startsAt.getTime() - 24 * HOUR_MS).toISOString(),
      isOnTime: true,
      canCancel: true,
      canReschedule: true,
    },
  };

  const allowance: AllowanceSummary = {
    purchaseId: SIMULATION_IDS.purchase,
    sessionAllowanceId: SIMULATION_IDS.allowance,
    producerId: SIMULATION_IDS.studio,
    producerName: input.producerName,
    projectId: SIMULATION_IDS.project,
    projectTitle: input.projectTitle,
    packageName: input.productName,
    kind: input.unlimitedSessions ? "unlimited" : "fixed",
    sessionLimit: input.unlimitedSessions ? null : input.sessionCount,
    sessionsUsed: 1,
    sessionsRemaining: input.unlimitedSessions ? null : Math.max(0, input.sessionCount - 1),
    durationMin: input.durationMin,
    locationType: "studio",
    bufferMinutes: 30,
    minLeadHours: 24,
    closedAtISO: null,
    canBook: true,
    bookingBlockedReason: null,
  };

  return { item, allowance, nowISO: input.now.toISOString() };
}

function buildSong(input: {
  producerName: string;
  artistName: string;
  projectTitle: string;
  now: Date;
  delivery: VersionDeliveryState;
}): SimulationSong {
  const { now, delivery } = input;
  const uploadedV1 = new Date(now.getTime() - 5 * DAY_MS).toISOString();
  const uploadedV2 = new Date(now.getTime() - DAY_MS).toISOString();

  const versions: SongPageData["versions"] = [
    {
      id: SIMULATION_IDS.versionTwo,
      label: "v2",
      audioUrl: SILENT_AUDIO_DATA_URL,
      audioDeletedAtIso: null,
      durationMs: SONG_DURATION_MS,
      uploadedAtIso: uploadedV2,
      // Marked ready by the producer, waiting on her exact approval.
      producerMarkedFinalAtIso: uploadedV2,
      artistApprovedAtIso: null,
      previouslyArtistApprovedAtIso: null,
      peaks: previewPeaks(3),
      delivery,
    },
    {
      id: SIMULATION_IDS.versionOne,
      label: "v1",
      audioUrl: SILENT_AUDIO_DATA_URL,
      audioDeletedAtIso: null,
      durationMs: SONG_DURATION_MS,
      uploadedAtIso: uploadedV1,
      producerMarkedFinalAtIso: null,
      artistApprovedAtIso: null,
      previouslyArtistApprovedAtIso: null,
      peaks: previewPeaks(17),
      delivery,
    },
  ];

  const comments: SongPageData["comments"] = [
    {
      id: SIMULATION_IDS.commentOne,
      versionId: SIMULATION_IDS.versionTwo,
      timeMs: 42_000,
      body: "This is the take. Keep the vocal exactly like this.",
      fromProducer: false,
      authorName: input.artistName,
      createdAtIso: new Date(now.getTime() - 20 * HOUR_MS).toISOString(),
      resolvedAtIso: null,
    },
    {
      id: SIMULATION_IDS.commentTwo,
      versionId: SIMULATION_IDS.versionTwo,
      timeMs: 42_000,
      body: "Kept. That is the one on v2.",
      fromProducer: true,
      authorName: input.producerName,
      createdAtIso: new Date(now.getTime() - 18 * HOUR_MS).toISOString(),
      resolvedAtIso: null,
    },
  ];

  const data: SongPageData = {
    track: {
      id: SIMULATION_IDS.track,
      title: input.projectTitle,
      artist: input.artistName,
      projectId: SIMULATION_IDS.project,
      projectTitle: input.projectTitle,
      // Artist mode overloads clientName with the producer's display name.
      clientName: input.producerName,
      artworkUrl: null,
      archivedAtIso: null,
      releasedAtIso: null,
      workflowStage: "mastering",
      projectLifecycleStatus: "active",
      artistApprovalLocked: false,
      lyrics: null,
      lyricsUpdatedAtIso: null,
      lyricsUpdatedBy: null,
    },
    versions,
    comments,
    selectedVersionId: SIMULATION_IDS.versionTwo,
  };

  return {
    data,
    approved: {
      ...data,
      track: { ...data.track, artistApprovalLocked: true, workflowStage: "done" },
      versions: versions.map((version) =>
        version.id === SIMULATION_IDS.versionTwo
          ? { ...version, artistApprovedAtIso: now.toISOString() }
          : version,
      ),
    },
  };
}

function buildRequestSnapshot(input: {
  product: PurchaseProduct;
  taxMode: TaxMode;
  taxRatePct: number;
  totalCents: number;
  includesStudioTime: boolean;
  durationMin: number;
}): PurchaseCommercialSnapshot {
  const { product, taxMode, taxRatePct, totalCents } = input;
  return {
    version: 1,
    productOrOfferName: product.name,
    ...(product.tagline ? { tagline: product.tagline } : {}),
    deliverables: [...product.includes],
    lineItems: [
      {
        label: product.name,
        quantity: 1,
        listUnitPriceCents: product.priceCents,
        unitPriceCents: product.priceCents,
        totalCents: product.priceCents,
      },
    ],
    listSubtotalCents: product.priceCents,
    discountCents: 0,
    subtotalCents: product.priceCents,
    tax: {
      mode: taxMode,
      ratePct: taxMode === "tax_free" ? 0 : taxRatePct,
      amountCents: totalCents - product.priceCents,
    },
    totalCents,
    currency: product.currency,
    includedSongSpaces: product.pricingModel === "per_song" ? 1 : 0,
    session: input.includesStudioTime
      ? {
          limit: product.unlimitedSessions
            ? { kind: "unlimited" }
            : { kind: "fixed", count: product.sessions },
          durationMin: input.durationMin,
          locationType: "Studio",
          bufferMinutes: 30,
          minLeadHours: 24,
        }
      : null,
    revisionRule: product.unlimitedRevisions
      ? { kind: "unlimited" }
      : product.revisions > 0
        ? { kind: "fixed", count: product.revisions }
        : null,
    royaltyTerms: product.royaltyTerms,
    rights: [],
    // Nothing is chosen yet: she picks a plan only after the producer approves.
    selectedPaymentPlan: null,
    offeredPaymentPlans: [...product.paymentPlans],
    agreementText: product.agreementText ?? "",
  };
}

/**
 * The reel: one hook, four features, one landing screen. Every scene shows
 * a result, not a process, and ends on the same green check. The booking
 * scene needs studio time to book, so a product without it drops that scene.
 */
export function buildScenes(input: { includesStudioTime: boolean }): readonly SimulationScene[] {
  const draft: Omit<SimulationScene, "step">[] = [
    {
      id: "hook",
      side: "hook",
      headline: "One link instead of 5 apps.",
      line: "Your studio, your artists, your money. In one place.",
      durationMs: 3900,
    },
    {
      id: "link",
      side: "artist",
      headline: "Send your link.",
      line: "Artists sign up and book you.",
      durationMs: 5200,
    },
    {
      id: "booking",
      side: "artist",
      headline: "They book themselves.",
      line: "Only in your work hours. Synced to Google Calendar.",
      durationMs: 5400,
    },
    {
      id: "library",
      side: "artist",
      headline: "All demos in one library.",
      line: "Notes on the exact second. Approval locks the version.",
      durationMs: 5900,
    },
    {
      id: "money",
      side: "producer",
      headline: "Get paid first.",
      line: "Download opens only after full payment. Reminders are automatic.",
      durationMs: 5600,
    },
    {
      id: "studio",
      side: "producer",
      headline: "Everything in one place.",
      line: "Clients, sessions, songs, money.",
      durationMs: 5200,
    },
  ];
  const kept = draft.filter((scene) => input.includesStudioTime || scene.id !== "booking");
  return Object.freeze(kept.map((scene, index) => ({ ...scene, step: index + 1 })));
}

function buildLibrary(input: { song: SimulationSong; now: Date }): MusicLibraryTrackRow[] {
  const { now } = input;
  const latest = input.song.data.versions[0];
  const base = {
    producerId: SIMULATION_IDS.studio,
    clientName: SIMULATED_ARTIST.name,
    trackArtist: SIMULATED_ARTIST.name,
    archivedAtIso: null,
    releasedAtIso: null,
    audioDeletedAtIso: null,
    audioUrl: SILENT_AUDIO_DATA_URL,
    plays: 0,
  };
  return [
    {
      ...base,
      id: SIMULATION_IDS.track,
      trackId: SIMULATION_IDS.track,
      trackTitle: SIMULATED_ARTIST.projectTitle,
      projectId: SIMULATION_IDS.project,
      projectTitle: SIMULATED_ARTIST.projectTitle,
      label: latest?.label ?? "v2",
      latestVersionId: SIMULATION_IDS.versionTwo,
      uploadedAtIso: latest?.uploadedAtIso ?? now.toISOString(),
      durationMs: SONG_DURATION_MS,
      peaks: previewPeaks(3),
      unreadComments: 1,
    },
    {
      ...base,
      id: SIMULATION_IDS.trackTwo,
      trackId: SIMULATION_IDS.trackTwo,
      trackTitle: "Night Drive",
      projectId: SIMULATION_IDS.projectTwo,
      projectTitle: "Night Drive",
      label: "v1",
      latestVersionId: SIMULATION_IDS.versionThree,
      uploadedAtIso: new Date(now.getTime() - 9 * DAY_MS).toISOString(),
      durationMs: 171_000,
      peaks: previewPeaks(29),
      unreadComments: 0,
    },
    {
      ...base,
      id: SIMULATION_IDS.trackThree,
      trackId: SIMULATION_IDS.trackThree,
      trackTitle: "Golden",
      projectId: SIMULATION_IDS.projectThree,
      projectTitle: "Golden",
      label: "v3",
      latestVersionId: SIMULATION_IDS.versionFour,
      uploadedAtIso: new Date(now.getTime() - 16 * DAY_MS).toISOString(),
      durationMs: 220_000,
      peaks: previewPeaks(41),
      unreadComments: 0,
    },
  ];
}

export function buildSimulation(input: SimulationInput, now: Date): SimulationModel {
  const displayName = input.producerName.trim() || "Your studio";
  const producer: Producer = {
    name: displayName,
    initials: producerInitials(displayName),
    hue: producerHue(displayName),
  };
  const product = toSimulationPurchaseProduct(input.product);
  const currency = product.currency;
  const totalCents = applyTaxToCents(product.priceCents, input.taxMode, input.taxRatePct);
  const plans = offeredPlans(product.paymentPlans);
  const selectedPlan = chooseStoryPlan(plans);
  const planOptions = livePlanOptions(
    plans.map((plan) => {
      const charges = simulatedCharges(plan, totalCents);
      return {
        kind: plan.kind,
        ...(plan.kind === "monthly" ? { installments: plan.installments } : {}),
        charges,
        dueNowCents: charges[0] ?? 0,
        labels: charges.map(() => ""),
      };
    }),
  );
  const charges = simulatedCharges(selectedPlan, totalCents);
  const dueNowCents = charges[0] ?? 0;
  const remainingCents = Math.max(0, totalCents - dueNowCents);
  const finalPaymentTrigger: SimulationModel["finalPaymentTrigger"] =
    selectedPlan.kind === "split_50_50"
      ? "artist_approval"
      : selectedPlan.kind === "monthly"
        ? "monthly"
        : "none";
  const planLabel = paymentPlanLabel(
    selectedPlan.kind,
    selectedPlan.kind === "monthly" ? selectedPlan.installments : null,
  );
  const hasOwnDetails =
    input.paymentDetails !== null &&
    Boolean(input.paymentDetails.bankTransfer?.trim() || input.paymentDetails.bitPhone?.trim());
  const paymentDetails =
    hasOwnDetails && input.paymentDetails ? input.paymentDetails : EXAMPLE_PAYMENT_DETAILS;
  const money = (cents: number) => formatMoney(cents, currency, { withCents: cents % 100 !== 0 });

  // The money scene confirms the LAST installment, so "download opens" is
  // literally true the moment the producer taps Confirm.
  const finalAmountCents = charges[charges.length - 1] ?? totalCents;
  const proof: ProducerPaymentProofReview["proof"] = {
    proofId: SIMULATION_IDS.proof,
    purchaseId: SIMULATION_IDS.purchase,
    purchaseRequestId: SIMULATION_IDS.purchaseRequest,
    installmentId: SIMULATION_IDS.installment,
    installmentPosition: charges.length,
    installmentAmountCents: finalAmountCents,
    refNumber: SIMULATION_IDS.requestRef,
    artistName: SIMULATED_ARTIST.name,
    projectId: SIMULATION_IDS.project,
    projectTitle: SIMULATED_ARTIST.projectTitle,
    productNameSnapshot: product.name,
    amountCents: finalAmountCents,
    totalCents,
    currency,
    originalFileName: SIMULATED_ARTIST.proofFileName,
    contentType: "image/png",
    sizeBytes: 248_320,
    proofNote: "Sent by Bit just now.",
    createdAt: now,
    status: "pending",
    rejectionNote: null,
    confirmedAt: null,
    rejectedAt: null,
  };
  const proofReview: ProducerPaymentProofReview = {
    proof,
    evidenceUrl: svgReceipt({
      producerName: displayName,
      amountLabel: money(finalAmountCents),
      reference: SIMULATION_IDS.requestRef,
    }),
    evidenceExpiresInSeconds: 300,
    history: [proof],
  };

  // The product is the parent of session time: no studio minutes means the
  // story has nothing to book, so it drops that frame entirely.
  const includesStudioTime = input.product.durationMin > 0;
  const delivery: VersionDeliveryState = {
    purchaseId: SIMULATION_IDS.purchase,
    permission: remainingCents === 0 ? "purchase_fully_paid" : "payment_required",
    fullyPaid: remainingCents === 0,
    remainingCents,
    currency,
    overdue: false,
    totalCents,
  };
  const song = buildSong({
    producerName: displayName,
    artistName: SIMULATED_ARTIST.name,
    projectTitle: SIMULATED_ARTIST.projectTitle,
    now,
    delivery,
  });
  const sessionShape = {
    producerName: displayName,
    productName: product.name,
    projectTitle: SIMULATED_ARTIST.projectTitle,
    sessionCount: product.sessions,
    unlimitedSessions: product.unlimitedSessions,
    durationMin: input.product.durationMin,
    timeZone: input.timezone,
    now,
  };
  const { booking, sessionStartsAt } = buildBooking({
    ...sessionShape,
    producerLogoUrl: input.producerLogoUrl,
  });
  const session = buildSession({ ...sessionShape, startsAt: sessionStartsAt });
  const sessionClock = new Intl.DateTimeFormat("en-US", {
    timeZone: input.timezone,
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(sessionStartsAt);

  // The dashboard frame is the studio on the morning of her session, so the
  // live "Today" card is telling the truth. Without studio time there is no
  // session to jump to, and the frame stays on the story's own clock.
  const dashboardNow = includesStudioTime
    ? new Date(sessionStartsAt.getTime() - 6 * HOUR_MS)
    : now;
  const dashboard: SimulationDashboard = {
    now: dashboardNow,
    // The studio scene is the morning after her last payment: paid in full,
    // three projects, nothing to chase.
    pulseStats: {
      commercialAvailable: true,
      thisMonthCents: totalCents,
      outstandingCents: 0,
      currency,
      activeProjects: 3,
    },
    todaySession: includesStudioTime
      ? {
          id: SIMULATION_IDS.session,
          title: `${product.name} with ${SIMULATED_ARTIST.firstName}`,
          subtitle: sessionClock,
          occurredAt: sessionStartsAt,
          href: SIMULATION_INERT_HREF,
        }
      : null,
    recentUploads: [
      {
        versionId: SIMULATION_IDS.versionTwo,
        trackId: SIMULATION_IDS.track,
        title: SIMULATED_ARTIST.projectTitle,
        versionLabel: "v2",
        uploadedAt: new Date(now.getTime() - DAY_MS),
        durationMs: SONG_DURATION_MS,
        projectId: SIMULATION_IDS.project,
        projectClientName: SIMULATED_ARTIST.name,
      },
      {
        versionId: SIMULATION_IDS.versionThree,
        trackId: SIMULATION_IDS.trackTwo,
        title: "Night Drive",
        versionLabel: "v1",
        uploadedAt: new Date(now.getTime() - 9 * DAY_MS),
        durationMs: 171_000,
        projectId: SIMULATION_IDS.projectTwo,
        projectClientName: SIMULATED_ARTIST.name,
      },
    ],
    // Paid in full, so there is nothing to chase and the queue stays empty.
    paymentBalances: [],
  };

  const request: SimulationRequest = {
    snapshot: buildRequestSnapshot({
      product,
      taxMode: input.taxMode,
      taxRatePct: input.taxRatePct,
      totalCents,
      includesStudioTime,
      durationMin: input.product.durationMin,
    }),
    submittedAtLabel: new Intl.DateTimeFormat("en-US", {
      timeZone: input.timezone,
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(now.getTime() - 2 * HOUR_MS)),
    totalLabel: money(totalCents),
    brief: "Debut single. Warm and close, live drums if we can.",
    artistEmail: "noya.levi@skitza.invalid",
  };

  return {
    producer,
    producerLogoUrl: input.producerLogoUrl,
    product,
    taxMode: input.taxMode,
    taxRatePct: input.taxRatePct,
    totalCents,
    currency,
    planOptions,
    selectedPlan,
    storyPlans: [selectedPlan, ...plans.filter((plan) => plan !== selectedPlan)],
    planLabel,
    dueNowCents,
    remainingCents,
    finalPaymentTrigger,
    paymentDetails,
    paymentDetailsAreExample: !hasOwnDetails,
    proofReview,
    includesStudioTime,
    song,
    booking,
    session,
    dashboard,
    request,
    library: buildLibrary({ song, now }),
    scenes: buildScenes({ includesStudioTime }),
  };
}

/** The dev-preview studio (`?__preview=1`) so the wizard walkthrough stays self-contained. */
export const PREVIEW_SIMULATION_INPUT: SimulationInput = {
  producerName: "Maya Stone",
  producerLogoUrl: null,
  timezone: "Asia/Jerusalem",
  product: {
    id: "onboarding-preview-product",
    name: "Signature production",
    tagline: "From the first idea to a release-ready master.",
    priceCents: 180000,
    currency: "ILS",
    pricingModel: "flat",
    volumeTiers: [],
    durationMin: 60,
    sessionCount: 3,
    deliverables: ["Production", "Mix", "Master"],
    revisions: 2,
    unlimitedRevisions: false,
    paymentPlans: [{ kind: "split_50_50" }, { kind: "full" }],
    royaltyTerms: { master: { mode: "none" }, composition: { mode: "none" } },
    agreementText: "",
  },
  taxMode: "tax_free",
  taxRatePct: 18,
  paymentDetails: null,
};
