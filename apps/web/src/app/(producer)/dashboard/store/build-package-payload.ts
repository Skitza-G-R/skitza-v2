import type { PaymentPlan, ProductRoyaltyTerms } from "@skitza/db";

import type { AgreementPdfChange, PackageKind } from "~/app/(producer)/dashboard/booking/actions";
import type { VolumeTier } from "~/lib/pricing";

import { encodeDescription } from "./description-encoding";
import {
  buildPaymentPlans,
  royaltyDraftToTerms,
  type AgreementMode,
  type AgreementPdfDraft,
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
  /** Missing only for older/shared callers; bookingEnabled supplies their session choice. */
  includesSessions?: boolean;
  sessions: number;
  unlimitedSessions: boolean;
  bookingEnabled: boolean;
  payment: PaymentSelectionDraft;
  includes: string[];
  duration: string;
  revisions: number;
  unlimitedRevisions: boolean;
  agreementMode: AgreementMode;
  agreementText: string;
  agreementPdf?: AgreementPdfDraft | null;
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
  bookingEnabled: boolean;
  paymentPlans: PaymentPlan[];
  deliverables: string[];
  royaltyTerms: ProductRoyaltyTerms | null;
  agreementText: string | null;
  agreementPdf: AgreementPdfChange;
  pricingModel: "flat" | "per_song";
  volumeTiers: VolumeTier[];
}

export type PackageUpdatePayload = PackagePayload;

function parseDurationMin(duration: string): number {
  const match = duration.match(/(\d+)\s*min/i);
  return match ? Number.parseInt(match[1] ?? "0", 10) : 0;
}

function resolveAgreementText(
  mode: AgreementMode,
  text: string,
): string | null {
  if (mode !== "text") return null;
  const trimmed = text.trim();
  return trimmed || null;
}

export function resolveAgreementPdfChange(
  mode: AgreementMode,
  pdf: AgreementPdfDraft | null | undefined,
  uploadToken: string | null = null,
): AgreementPdfChange {
  if (mode !== "pdf") return { kind: "remove" };
  if (uploadToken) return { kind: "replace", uploadToken };
  if (pdf?.documentId) return { kind: "keep", documentId: pdf.documentId };
  throw new Error("Upload the agreement PDF or choose no attachment.");
}

export function buildPackagePayload(
  draft: PackageDraft,
  existingProductKind?: string,
  agreementPdfUploadToken: string | null = null,
): PackagePayload {
  // Description remains the compatibility carrier for tagline/revisions.
  // Inline agreement text is deliberately excluded and written to its own
  // column below, so editing a legacy product migrates the terms safely.
  const description = encodeDescription({
    tagline: draft.tagline.trim(),
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
  const includesSessions = draft.includesSessions ?? draft.bookingEnabled;

  return {
    name: draft.name.trim(),
    description,
    kind,
    priceCents: Math.round(draft.price * 100),
    currency: draft.currency,
    durationMin: includesSessions ? parseDurationMin(draft.duration) : 0,
    sessionCount:
      includesSessions
        ? draft.unlimitedSessions
          ? 0
          : Math.max(1, draft.sessions)
        : 0,
    bookingEnabled: includesSessions,
    paymentPlans: buildPaymentPlans(draft.payment),
    deliverables: draft.includes
      .map((item) => item.trim())
      .filter(Boolean),
    royaltyTerms: royaltyDraftToTerms(draft.royalty),
    agreementText: resolveAgreementText(draft.agreementMode, draft.agreementText),
    agreementPdf: resolveAgreementPdfChange(
      draft.agreementMode,
      draft.agreementPdf,
      agreementPdfUploadToken,
    ),
    pricingModel: draft.pricingModel,
    volumeTiers: draft.volumeTiers,
  };
}

export function buildPackageUpdatePayload(
  draft: PackageDraft,
  existingProductKind: string,
  agreementPdfUploadToken: string | null = null,
): PackageUpdatePayload {
  return buildPackagePayload(draft, existingProductKind, agreementPdfUploadToken);
}
