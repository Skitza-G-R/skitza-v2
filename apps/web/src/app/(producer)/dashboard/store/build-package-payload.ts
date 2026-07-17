import type { PaymentPlan, ProductRoyaltyTerms } from "@skitza/db";

import type { PackageKind } from "~/app/(producer)/dashboard/booking/actions";
import type { VolumeTier } from "~/lib/pricing";

import { encodeDescription } from "./description-encoding";
import {
  buildPaymentPlans,
  royaltyDraftToTerms,
  type AgreementMode,
  type PaymentSelectionDraft,
  type ProductRoyaltyDraft,
} from "./product-editor-draft";
import type { PresetType } from "./type-presets";

type Currency = "USD" | "EUR" | "GBP" | "ILS";

export interface PackageDraft {
  name: string;
  tagline: string;
  type: PresetType;
  price: number;
  currency: Currency;
  sessions: number;
  unlimitedSessions: boolean;
  payment: PaymentSelectionDraft;
  includes: string[];
  duration: string;
  revisions: number;
  unlimitedRevisions: boolean;
  agreementMode: AgreementMode;
  contractUrl: string;
  agreementText: string;
  royalty: ProductRoyaltyDraft;
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
  deliverables: string[];
  royaltyTerms: ProductRoyaltyTerms | null;
  agreementText: string | null;
  contractUrl: string | null;
  pricingModel: "flat" | "per_song";
  volumeTiers: VolumeTier[];
}

export type PackageUpdatePayload = PackagePayload;

function parseDurationMin(duration: string): number {
  const match = duration.match(/(\d+)\s*min/i);
  return match ? Number.parseInt(match[1] ?? "0", 10) : 0;
}

function resolveContractUrl(
  mode: AgreementMode,
  url: string,
): string | null {
  if (mode !== "link") return null;
  const trimmed = url.trim();
  return trimmed || null;
}

function resolveAgreementText(
  mode: AgreementMode,
  text: string,
): string | null {
  if (mode !== "text") return null;
  const trimmed = text.trim();
  return trimmed || null;
}

export function buildPackagePayload(
  draft: PackageDraft,
  existingProductKind?: string,
): PackagePayload {
  // Description remains the compatibility carrier for tagline/revisions.
  // Inline agreement text is deliberately excluded and written to its own
  // column below, so editing a legacy product migrates the terms safely.
  const description = encodeDescription({
    tagline: draft.tagline,
    revisions: draft.revisions,
    unlimitedRevisions: draft.unlimitedRevisions,
    contractText: "",
  });

  const kind: PackageKind =
    existingProductKind !== undefined
      ? (existingProductKind as PackageKind)
      : draft.type === "consult"
        ? ("custom" as PackageKind)
        : (draft.type as PackageKind);

  return {
    name: draft.name.trim(),
    description,
    kind,
    priceCents: Math.round(draft.price * 100),
    currency: draft.currency,
    durationMin: parseDurationMin(draft.duration),
    sessionCount: draft.unlimitedSessions
      ? 0
      : Math.max(1, draft.sessions),
    paymentPlans: buildPaymentPlans(draft.payment),
    deliverables: draft.includes
      .map((item) => item.trim())
      .filter(Boolean),
    royaltyTerms: royaltyDraftToTerms(draft.royalty),
    agreementText: resolveAgreementText(
      draft.agreementMode,
      draft.agreementText,
    ),
    contractUrl: resolveContractUrl(draft.agreementMode, draft.contractUrl),
    pricingModel: draft.pricingModel,
    volumeTiers: draft.volumeTiers,
  };
}

export function buildPackageUpdatePayload(
  draft: PackageDraft,
  existingProductKind: string,
): PackageUpdatePayload {
  return buildPackagePayload(draft, existingProductKind);
}
