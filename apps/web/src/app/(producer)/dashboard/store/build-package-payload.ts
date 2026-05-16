// build-package-payload.ts
//
// Pure mapping: wizard Draft → server-action createPackage / updatePackage
// payload. Extracted from product-editor.tsx's save() handler so the
// wire shape can be unit-tested without rendering the modal.
//
// Used by both create and edit flows. The caller is responsible for:
//   - Calling createPackage(payload) or updatePackage({ id, ...payload })
//   - Threading the existing product's kind on edit (legacy DB rows use
//     kinds like "session"/"mixing" that the wizard's presets don't
//     cover; we preserve them via existingProductKind).

import type { PaymentPlan } from "@skitza/db";

import type { PackageKind } from "~/app/(producer)/dashboard/booking/actions";
import type { VolumeTier } from "~/lib/pricing";

import { encodeDescription } from "./description-encoding";
import type { ContractMode } from "./editor-steps/contract-step";
import type { PaymentPlanChoice, PresetType } from "./type-presets";

type Currency = "USD" | "EUR" | "GBP" | "ILS";

export interface PackageDraft {
  name: string;
  tagline: string;
  type: PresetType;
  price: number;
  currency: Currency;
  sessions: number;
  unlimitedSessions: boolean;
  paymentPlan: PaymentPlanChoice;
  installmentsCount: number;
  duration: string;
  revisions: number;
  unlimitedRevisions: boolean;
  contractMode: ContractMode;
  contractUrl: string;
  contractText: string;
  pricingModel: "flat" | "per_song";
  volumeTiers: VolumeTier[];
}

export interface PackagePayload {
  name: string;
  description: string;
  kind: PackageKind;
  priceCents: number;
  currency: Currency;
  durationMin: number;
  sessionCount: number;
  paymentPlans: PaymentPlan[];
  depositPct: 0;
  contractUrl: string | null;
  pricingModel: "flat" | "per_song";
  volumeTiers: VolumeTier[];
}

// Helper — turn the wizard's three-option paymentPlan choice into the
// DB's discriminated-union shape. Mirrors the inline logic the save
// handler used before extraction.
function toPaymentPlans(
  choice: PaymentPlanChoice,
  installmentsCount: number,
): PaymentPlan[] {
  if (choice === "full") return [{ kind: "full" }];
  if (choice === "split") return [{ kind: "split_50_50" }];
  return [{ kind: "monthly", installments: Math.max(2, installmentsCount) }];
}

// Helper — parse "60 min" / "120 min" / custom "{N} min" to int.
// canContinue() in the wizard already guarantees the format matches;
// fallback to 0 is defensive only.
function parseDurationMin(duration: string): number {
  const m = duration.match(/(\d+)\s*min/i);
  return m ? parseInt(m[1] ?? "0", 10) : 0;
}

// Helper — resolve contractUrl based on contract mode. Text mode
// stores the inline terms in the description meta block (encoded by
// encodeDescription); the URL column is null in that case. Link mode
// stores the trimmed URL or null if empty.
function resolveContractUrl(
  mode: ContractMode,
  url: string,
): string | null {
  if (mode === "text") return null;
  const trimmed = url.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function buildPackagePayload(
  draft: PackageDraft,
  existingProductKind?: string,
): PackagePayload {
  const description = encodeDescription({
    tagline: draft.tagline,
    revisions: draft.revisions,
    unlimitedRevisions: draft.unlimitedRevisions,
    contractText: draft.contractMode === "text" ? draft.contractText : "",
  });

  // EDIT: preserve the existing DB kind exactly (legacy kinds like
  // "session"/"mixing"/etc. are valid). NEW: map preset type, with
  // "consult" routed to "custom" because the ProductKind enum has no
  // "consult" variant.
  const kind: PackageKind =
    existingProductKind != null
      ? (existingProductKind as PackageKind)
      : draft.type === "consult"
        ? ("custom" as PackageKind)
        : (draft.type as PackageKind);

  // For per-song products priceCents mirrors the base tier so legacy
  // flat-price code paths (card lists, filters, search) keep working
  // with sane numbers. updateBaseTier() in pricing-step.tsx keeps
  // draft.price in sync with volumeTiers[0].pricePerUnitCents while
  // editing, so reading from draft.price is correct in both modes.
  const priceCents = Math.round(draft.price * 100);

  return {
    name: draft.name.trim(),
    description,
    kind,
    priceCents,
    currency: draft.currency,
    durationMin: parseDurationMin(draft.duration),
    sessionCount: draft.unlimitedSessions ? 0 : Math.max(1, draft.sessions),
    paymentPlans: toPaymentPlans(draft.paymentPlan, draft.installmentsCount),
    // The wizard dropped the Deposit field when PricingStep was
    // simplified; depositPct: 0 means "no upfront deposit — the
    // paymentPlans schedule controls when money moves." Works for
    // all three plan options.
    depositPct: 0,
    contractUrl: resolveContractUrl(draft.contractMode, draft.contractUrl),
    pricingModel: draft.pricingModel,
    // Empty array on flat clears any prior per-song tiers in the DB.
    // The tRPC schema accepts [] (max 10, optional); the artist-side
    // read treats !volumeTiers.length as flat-price regardless of
    // pricingModel — defensive.
    volumeTiers: draft.volumeTiers,
  };
}
