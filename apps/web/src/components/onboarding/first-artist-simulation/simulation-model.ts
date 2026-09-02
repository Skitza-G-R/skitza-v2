// "Watch your first artist" (SK-298) — pure model for the render-only
// simulation shown right after a producer publishes their page.
//
// Everything here is derived from the producer's REAL first product plus one
// fictional artist. Nothing is persisted: the overlay renders the live artist
// and producer screens with these props and never calls a mutation.

import type { PaymentPlan, ProductRoyaltyTerms } from "@skitza/db";

import {
  livePlanOptions,
  paymentPlanLabel,
  type LivePaymentPlanChoice,
  type LivePlanOption,
} from "~/components/artist/purchase/pay-data";
import type { PaymentDetails } from "~/components/artist/purchase/payment-instructions-screen";
import type { Producer, PurchaseProduct } from "~/components/artist/purchase/purchase-data";
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

/** Shown on every frame. Tests pin the exact wording. */
export const SIMULATION_LABEL = "Simulation · Noya is not real";

// Deterministic, obviously-fake identifiers. They never reach the database;
// they exist because the reused screens require ids for keys and labels.
export const SIMULATION_IDS = {
  purchase: "00000000-0000-4000-8000-00000000s298",
  purchaseRequest: "00000000-0000-4000-8000-00000000s299",
  installment: "00000000-0000-4000-8000-00000000s300",
  proof: "00000000-0000-4000-8000-00000000s301",
  project: "00000000-0000-4000-8000-00000000s302",
  studio: "simulation-studio",
  requestRef: "SK-SIM298",
} as const;

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
  product: SimulationProduct;
  taxMode: TaxMode;
  taxRatePct: number;
  /** The producer's own bank/Bit details when already saved; null shows an example. */
  paymentDetails: PaymentDetails | null;
}

export type SimulationFrameId =
  | "store"
  | "detail"
  | "request"
  | "request-sent"
  | "choose-plan"
  | "agreement"
  | "pay"
  | "proof"
  | "needs-you"
  | "verify"
  | "outcome"
  | "closing";

export type SimulationSide = "artist" | "producer" | "closing";

export interface SimulationFrame {
  id: SimulationFrameId;
  side: SimulationSide;
  /** 1-based position among the numbered frames; the closing card has none. */
  step: number | null;
  /** What Noya (or the producer) does on this frame. */
  caption: string;
  /** One supporting line under the caption. */
  detail: string;
  /** The producer is expected to act on this frame (a real control advances it). */
  interactive: boolean;
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
  frames: readonly SimulationFrame[];
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

function buildFrames(input: {
  firstName: string;
  producerName: string;
  productName: string;
  dueNowLabel: string;
  totalLabel: string;
  planLabel: string;
}): readonly SimulationFrame[] {
  const { firstName, producerName, productName, dueNowLabel, totalLabel, planLabel } = input;
  const frames: SimulationFrame[] = [
    {
      id: "store",
      side: "artist",
      step: 1,
      caption: `${firstName} opens your link and sees your Store.`,
      detail: `${productName}, exactly as a connected artist sees it.`,
      interactive: false,
    },
    {
      id: "detail",
      side: "artist",
      step: 2,
      caption: `She reads what's included and taps Request to book.`,
      detail: "Price, sessions, revisions and rights come straight from your product.",
      interactive: false,
    },
    {
      id: "request",
      side: "artist",
      step: 3,
      caption: "She sends her request with a short brief.",
      detail: "Nothing is paid or promised yet. You decide.",
      interactive: false,
    },
    {
      id: "request-sent",
      side: "artist",
      step: 4,
      caption: "Her request lands in your Needs you.",
      detail: `You approve it with one tap. ${firstName} is told what happens next.`,
      interactive: false,
    },
    {
      id: "choose-plan",
      side: "artist",
      step: 5,
      caption: "After your approval she picks a payment plan you offer.",
      detail: `The story continues with ${planLabel}.`,
      interactive: false,
    },
    {
      id: "agreement",
      side: "artist",
      step: 6,
      caption: "She accepts the exact agreement.",
      detail: `${totalLabel} and your terms freeze. Nothing can change quietly later.`,
      interactive: false,
    },
    {
      id: "pay",
      side: "artist",
      step: 7,
      caption: `She pays ${dueNowLabel} straight to you by Bit or bank transfer.`,
      detail: "Skitza never touches the money.",
      interactive: false,
    },
    {
      id: "proof",
      side: "artist",
      step: 8,
      caption: "She uploads the transfer screenshot.",
      detail: "That is her whole job. The rest is yours, and it takes one tap.",
      interactive: false,
    },
    {
      id: "needs-you",
      side: "producer",
      step: 9,
      caption: "Back on your side. This is what lands in Needs you.",
      detail: "You get a push the moment it happens. Tap Review to open it.",
      interactive: true,
    },
    {
      id: "verify",
      side: "producer",
      step: 10,
      caption: "Your turn: check the receipt and tap Confirm payment.",
      detail: `Confirm exactly what ${firstName} stated, or reject it with a note.`,
      interactive: true,
    },
    {
      id: "outcome",
      side: "producer",
      step: 11,
      caption: `${SIMULATED_ARTIST.projectTitle} is active. The headache is gone.`,
      detail: `Every payment, version and approval for ${firstName} now lives in one place, with ${producerName} in control.`,
      interactive: false,
    },
    {
      id: "closing",
      side: "closing",
      step: null,
      caption: "That was a simulation.",
      detail: `${SIMULATED_ARTIST.name} is not real. Who are you actually working with this week?`,
      interactive: false,
    },
  ];
  return Object.freeze(frames);
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

  const proof: ProducerPaymentProofReview["proof"] = {
    proofId: SIMULATION_IDS.proof,
    purchaseId: SIMULATION_IDS.purchase,
    purchaseRequestId: SIMULATION_IDS.purchaseRequest,
    installmentId: SIMULATION_IDS.installment,
    installmentPosition: 1,
    installmentAmountCents: dueNowCents,
    refNumber: SIMULATION_IDS.requestRef,
    artistName: SIMULATED_ARTIST.name,
    projectId: SIMULATION_IDS.project,
    projectTitle: SIMULATED_ARTIST.projectTitle,
    productNameSnapshot: product.name,
    amountCents: dueNowCents,
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
      amountLabel: money(dueNowCents),
      reference: SIMULATION_IDS.requestRef,
    }),
    evidenceExpiresInSeconds: 300,
    history: [proof],
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
    frames: buildFrames({
      firstName: SIMULATED_ARTIST.firstName,
      producerName: displayName,
      productName: product.name,
      dueNowLabel: money(dueNowCents),
      totalLabel: money(totalCents),
      planLabel,
    }),
  };
}

/** The dev-preview studio (`?__preview=1`) so the wizard walkthrough stays self-contained. */
export const PREVIEW_SIMULATION_INPUT: SimulationInput = {
  producerName: "Maya Stone",
  producerLogoUrl: null,
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
