import type {
  PaymentPlan,
  ProductRoyaltyTerms,
  PurchaseCommercialSnapshot,
} from "@skitza/db";

import { decodeDescription } from "~/app/(producer)/dashboard/store/description-encoding";
import type { TaxMode } from "~/lib/tax-mode";
import { assertCommercialSnapshotMatchesAcceptance } from "~/server/domain/purchases/commercial-snapshot";
import { digestCommercialSnapshot } from "~/server/domain/purchases/policy";

export const MAX_STORE_SONG_QUANTITY = 1_000;
const MAX_POSTGRES_INTEGER = 2_147_483_647;

export type StoreProductPricingModel = "flat" | "per_song" | "hourly" | "bundle";

export type StoreProductVolumeTier = Readonly<{
  minQty: number;
  pricePerUnitCents: number;
}>;

/**
 * Complete commercial state loaded from a product row after applying any
 * proposed patch. The domain deliberately accepts the database's free-text
 * pricing model and validates it at runtime before money is calculated.
 */
export type StoreProductCommercialInput = Readonly<{
  name: string;
  description: string | null;
  kind: string;
  pricingModel: string;
  priceCents: number;
  currency: string;
  volumeTiers: readonly StoreProductVolumeTier[] | null;
  hourlyRateCents: number | null;
  durationMin: number;
  sessionCount: number;
  deliverables: readonly string[] | null;
  locationType: string;
  bufferMinutes: number;
  minLeadHours: number;
  paymentPlans: readonly PaymentPlan[];
  royaltyTerms: ProductRoyaltyTerms | null;
  agreementText: string | null;
  active: boolean;
  archivedAt: Date | null;
}>;

export type ValidatedStoreProductCommercialInput = Readonly<
  Omit<
    StoreProductCommercialInput,
    "pricingModel" | "volumeTiers" | "deliverables" | "paymentPlans" | "royaltyTerms"
  > & {
    pricingModel: StoreProductPricingModel;
    volumeTiers: readonly StoreProductVolumeTier[];
    deliverables: readonly string[];
    paymentPlans: readonly PaymentPlan[];
    royaltyTerms: ProductRoyaltyTerms | null;
  }
>;

export type StoreProductCommercialPatch = {
  [Key in keyof StoreProductCommercialInput]?: StoreProductCommercialInput[Key] | undefined;
};

export type StoreProductCommercialErrorCode =
  | "INVALID_PRODUCT"
  | "PRODUCT_NOT_PUBLISHED"
  | "PUBLISHED_CASH_PRICE_REQUIRED"
  | "INVALID_VOLUME_TIERS"
  | "INVALID_PAYMENT_PLANS"
  | "PAYMENT_PLAN_NOT_OFFERED"
  | "INVALID_ROYALTY_TERMS"
  | "IMMUTABLE_AGREEMENT_REQUIRED"
  | "INVALID_SONG_QUANTITY"
  | "INVALID_TAX"
  | "PRICE_OVERFLOW";

export class StoreProductCommercialError extends Error {
  readonly code: StoreProductCommercialErrorCode;
  readonly field: string | null;

  constructor(code: StoreProductCommercialErrorCode, message: string, field: string | null = null) {
    super(message);
    this.name = "StoreProductCommercialError";
    this.code = code;
    this.field = field;
  }
}

function fail(
  code: StoreProductCommercialErrorCode,
  message: string,
  field: string | null = null,
): never {
  throw new StoreProductCommercialError(code, message, field);
}

function plainRecord(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const prototype = Object.getPrototypeOf(value) as object | null;
  if (prototype !== Object.prototype && prototype !== null) return null;
  return value as Record<string, unknown>;
}

function assertInteger(
  value: number,
  field: string,
  minimum: number,
  maximum = MAX_POSTGRES_INTEGER,
): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    fail(
      "INVALID_PRODUCT",
      `${field} must be an integer between ${String(minimum)} and ${String(maximum)}`,
      field,
    );
  }
  return value;
}

function normalizeRequiredText(value: string, field: string, maximum: number): string {
  if (typeof value !== "string") {
    fail("INVALID_PRODUCT", `${field} must be text`, field);
  }
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > maximum) {
    fail(
      "INVALID_PRODUCT",
      `${field} must contain between 1 and ${String(maximum)} characters`,
      field,
    );
  }
  return normalized;
}

function normalizeCurrency(value: string): string {
  if (typeof value !== "string") fail("INVALID_PRODUCT", "currency must be text", "currency");
  const currency = value.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) {
    fail("INVALID_PRODUCT", "currency must be a three-letter ISO code", "currency");
  }
  return currency;
}

function normalizeDeliverables(value: readonly string[] | null): readonly string[] {
  if (value === null) return Object.freeze([]);
  if (!Array.isArray(value) || value.length > 10) {
    fail("INVALID_PRODUCT", "deliverables must contain at most 10 items", "deliverables");
  }
  const result = value.map((entry, index) => {
    if (typeof entry !== "string") {
      fail("INVALID_PRODUCT", "Each deliverable must be text", `deliverables.${String(index)}`);
    }
    return normalizeRequiredText(entry, `deliverables.${String(index)}`, 100);
  });
  return Object.freeze(result);
}

function normalizeVolumeTiers(
  pricingModel: StoreProductPricingModel,
  value: readonly StoreProductVolumeTier[] | null,
): readonly StoreProductVolumeTier[] {
  if (pricingModel !== "per_song") {
    if (value === null) return Object.freeze([]);
    if (!Array.isArray(value)) {
      fail("INVALID_VOLUME_TIERS", "volumeTiers must be an array", "volumeTiers");
    }
    return Object.freeze(
      value.map((tier: StoreProductVolumeTier) =>
        Object.freeze({
          minQty: tier.minQty,
          pricePerUnitCents: tier.pricePerUnitCents,
        }),
      ),
    );
  }

  if (!Array.isArray(value) || value.length === 0 || value.length > 10) {
    fail(
      "INVALID_VOLUME_TIERS",
      "Per-song pricing requires between 1 and 10 volume tiers",
      "volumeTiers",
    );
  }

  const tiers = value.map((raw, index) => {
    const tier = plainRecord(raw);
    if (!tier) {
      fail(
        "INVALID_VOLUME_TIERS",
        "Each volume tier must be an object",
        `volumeTiers.${String(index)}`,
      );
    }
    const minQty = tier.minQty;
    const pricePerUnitCents = tier.pricePerUnitCents;
    if (
      typeof minQty !== "number" ||
      !Number.isSafeInteger(minQty) ||
      minQty < 1 ||
      minQty > MAX_STORE_SONG_QUANTITY
    ) {
      fail(
        "INVALID_VOLUME_TIERS",
        `Volume tier quantities must be integers from 1 to ${String(MAX_STORE_SONG_QUANTITY)}`,
        `volumeTiers.${String(index)}.minQty`,
      );
    }
    if (
      typeof pricePerUnitCents !== "number" ||
      !Number.isSafeInteger(pricePerUnitCents) ||
      pricePerUnitCents <= 0 ||
      pricePerUnitCents > MAX_POSTGRES_INTEGER
    ) {
      fail(
        "INVALID_VOLUME_TIERS",
        "Every volume tier must have a positive cash price",
        `volumeTiers.${String(index)}.pricePerUnitCents`,
      );
    }
    return { minQty, pricePerUnitCents };
  });

  tiers.sort((left, right) => left.minQty - right.minQty);
  if (tiers[0]?.minQty !== 1) {
    fail("INVALID_VOLUME_TIERS", "Per-song tiers must start at one song", "volumeTiers");
  }
  for (let index = 1; index < tiers.length; index += 1) {
    const previous = tiers[index - 1];
    const current = tiers[index];
    if (!previous || !current) continue;
    if (previous.minQty === current.minQty) {
      fail("INVALID_VOLUME_TIERS", "Volume tier quantities must be unique", "volumeTiers");
    }
    if (current.pricePerUnitCents > previous.pricePerUnitCents) {
      fail(
        "INVALID_VOLUME_TIERS",
        "A higher-volume tier cannot cost more per song than the tier before it",
        "volumeTiers",
      );
    }
  }
  return Object.freeze(tiers.map((tier) => Object.freeze({ ...tier })));
}

function planKey(plan: PaymentPlan): string {
  return plan.kind === "monthly"
    ? `monthly:${String(plan.installments)}`
    : plan.kind;
}

function normalizePlan(raw: unknown, field: string): PaymentPlan {
  const plan = plainRecord(raw);
  if (!plan) fail("INVALID_PAYMENT_PLANS", "Payment plans must be objects", field);
  const keys = Object.keys(plan).sort();
  if (plan.kind === "full" || plan.kind === "split_50_50") {
    if (keys.length !== 1 || keys[0] !== "kind") {
      fail("INVALID_PAYMENT_PLANS", "Payment plan contains unsupported fields", field);
    }
    return Object.freeze({ kind: plan.kind });
  }
  if (plan.kind === "monthly") {
    if (keys.length !== 2 || keys[0] !== "installments" || keys[1] !== "kind") {
      fail("INVALID_PAYMENT_PLANS", "Monthly plan contains unsupported fields", field);
    }
    if (
      typeof plan.installments !== "number" ||
      !Number.isSafeInteger(plan.installments) ||
      plan.installments < 2 ||
      plan.installments > 12
    ) {
      fail(
        "INVALID_PAYMENT_PLANS",
        "Monthly plans must contain between 2 and 12 installments",
        `${field}.installments`,
      );
    }
    return Object.freeze({ kind: "monthly", installments: plan.installments });
  }
  fail(
    "INVALID_PAYMENT_PLANS",
    "Products may offer only Full, 50/50, or Monthly plans",
    field,
  );
}

function normalizePaymentPlans(value: readonly PaymentPlan[]): readonly PaymentPlan[] {
  if (!Array.isArray(value) || value.length === 0) {
    fail("INVALID_PAYMENT_PLANS", "Choose at least one payment plan", "paymentPlans");
  }
  const plans = value.map((plan, index) => normalizePlan(plan, `paymentPlans.${String(index)}`));
  const kinds = plans.map((plan) => plan.kind);
  if (new Set(kinds).size !== kinds.length) {
    fail(
      "INVALID_PAYMENT_PLANS",
      "Each Full, 50/50, or Monthly plan may be enabled only once",
      "paymentPlans",
    );
  }
  const order: Record<PaymentPlan["kind"], number> = {
    full: 0,
    split_50_50: 1,
    monthly: 2,
  };
  plans.sort((left, right) => order[left.kind] - order[right.kind]);
  return Object.freeze(plans);
}

function normalizeRoyaltyPart(
  raw: unknown,
  field: string,
  composition: boolean,
): ProductRoyaltyTerms["master"] | ProductRoyaltyTerms["composition"] {
  const part = plainRecord(raw);
  if (!part) fail("INVALID_ROYALTY_TERMS", `${field} must be an object`, field);
  if (part.mode === "none" || part.mode === "agreement") {
    if (Object.keys(part).length !== 1) {
      fail("INVALID_ROYALTY_TERMS", `${field} contains unsupported fields`, field);
    }
    return Object.freeze({ mode: part.mode });
  }
  if (part.mode !== "percentage") {
    fail("INVALID_ROYALTY_TERMS", `${field} has an unsupported mode`, `${field}.mode`);
  }
  if (
    typeof part.bps !== "number" ||
    !Number.isSafeInteger(part.bps) ||
    part.bps < 1 ||
    part.bps > 10_000
  ) {
    fail(
      "INVALID_ROYALTY_TERMS",
      `${field} percentage must be between 0.01% and 100%`,
      `${field}.bps`,
    );
  }
  if (!composition) return Object.freeze({ mode: "percentage", bps: part.bps });

  const roles = new Set(["composer", "lyricist", "arranger", "publisher", "other"]);
  if (part.role !== undefined && (typeof part.role !== "string" || !roles.has(part.role))) {
    fail("INVALID_ROYALTY_TERMS", "Composition role is unsupported", `${field}.role`);
  }
  if (part.collectingSociety !== undefined && typeof part.collectingSociety !== "string") {
    fail(
      "INVALID_ROYALTY_TERMS",
      "Collecting society must be text",
      `${field}.collectingSociety`,
    );
  }
  const collectingSociety =
    typeof part.collectingSociety === "string" ? part.collectingSociety.trim() : "";
  if (collectingSociety.length > 200) {
    fail(
      "INVALID_ROYALTY_TERMS",
      "Collecting society must be 200 characters or fewer",
      `${field}.collectingSociety`,
    );
  }
  return Object.freeze({
    mode: "percentage",
    bps: part.bps,
    ...(typeof part.role === "string"
      ? {
          role: part.role as "composer" | "lyricist" | "arranger" | "publisher" | "other",
        }
      : {}),
    ...(collectingSociety ? { collectingSociety } : {}),
  });
}

function normalizeRoyaltyTerms(value: ProductRoyaltyTerms | null): ProductRoyaltyTerms | null {
  if (value === null) return null;
  const terms = plainRecord(value);
  if (!terms) fail("INVALID_ROYALTY_TERMS", "royaltyTerms must be an object", "royaltyTerms");
  const master = normalizeRoyaltyPart(terms.master, "royaltyTerms.master", false);
  const composition = normalizeRoyaltyPart(
    terms.composition,
    "royaltyTerms.composition",
    true,
  );
  if (terms.notes !== undefined && typeof terms.notes !== "string") {
    fail("INVALID_ROYALTY_TERMS", "Rights notes must be text", "royaltyTerms.notes");
  }
  const notes = typeof terms.notes === "string" ? terms.notes.trim() : "";
  if (notes.length > 4_000) {
    fail(
      "INVALID_ROYALTY_TERMS",
      "Rights notes must be 4,000 characters or fewer",
      "royaltyTerms.notes",
    );
  }
  return Object.freeze({
    master: master as ProductRoyaltyTerms["master"],
    composition: composition as ProductRoyaltyTerms["composition"],
    ...(notes ? { notes } : {}),
  });
}

function effectiveProducerAgreement(product: StoreProductCommercialInput): string {
  if (product.agreementText !== null) return product.agreementText.trim();
  return decodeDescription(product.description).contractText.trim();
}

function effectivePriceCents(product: ValidatedStoreProductCommercialInput): number {
  if (product.pricingModel === "hourly") return product.hourlyRateCents ?? 0;
  if (product.pricingModel === "per_song") return product.volumeTiers[0]?.pricePerUnitCents ?? 0;
  return product.priceCents;
}

function paymentPlanInstallmentCount(plan: PaymentPlan): number {
  if (plan.kind === "full") return 1;
  if (plan.kind === "split_50_50") return 2;
  return plan.installments;
}

function minimumPurchaseSubtotalCents(
  product: ValidatedStoreProductCommercialInput,
): bigint {
  if (product.pricingModel !== "per_song") {
    return BigInt(effectivePriceCents(product));
  }

  let minimum: bigint | null = null;
  for (const tier of product.volumeTiers) {
    const tierOpeningSubtotal = BigInt(tier.minQty) * BigInt(tier.pricePerUnitCents);
    if (minimum === null || tierOpeningSubtotal < minimum) {
      minimum = tierOpeningSubtotal;
    }
  }
  return minimum ?? 0n;
}

function assertFeasiblePaymentPlans(product: ValidatedStoreProductCommercialInput): void {
  const maximumInstallmentCount = product.paymentPlans.reduce(
    (maximum, plan) => Math.max(maximum, paymentPlanInstallmentCount(plan)),
    1,
  );
  if (minimumPurchaseSubtotalCents(product) < BigInt(maximumInstallmentCount)) {
    fail(
      "INVALID_PAYMENT_PLANS",
      "Published Store pricing must provide at least one cent for every enabled installment",
      "paymentPlans",
    );
  }
}

function assertSignedInStorePricingSupported(
  product: ValidatedStoreProductCommercialInput,
): void {
  if (product.pricingModel === "hourly") {
    fail(
      "INVALID_PRODUCT",
      "Hourly pricing is not available in the signed-in Store",
      "pricingModel",
    );
  }
}

function normalizeProduct(
  product: StoreProductCommercialInput,
): ValidatedStoreProductCommercialInput {
  const name = normalizeRequiredText(product.name, "name", 200);
  const kind = normalizeRequiredText(product.kind, "kind", 100);
  if (
    product.pricingModel !== "flat" &&
    product.pricingModel !== "per_song" &&
    product.pricingModel !== "hourly" &&
    product.pricingModel !== "bundle"
  ) {
    fail("INVALID_PRODUCT", "pricingModel is unsupported", "pricingModel");
  }
  const pricingModel = product.pricingModel;
  const priceCents = assertInteger(product.priceCents, "priceCents", 0);
  const hourlyRateCents =
    product.hourlyRateCents === null
      ? null
      : assertInteger(product.hourlyRateCents, "hourlyRateCents", 0);
  const volumeTiers = normalizeVolumeTiers(pricingModel, product.volumeTiers);
  if (
    pricingModel === "per_song" &&
    volumeTiers[0] &&
    priceCents !== volumeTiers[0].pricePerUnitCents
  ) {
    fail(
      "INVALID_VOLUME_TIERS",
      "priceCents must match the one-song base tier",
      "priceCents",
    );
  }

  const archivedAt = product.archivedAt;
  if (
    archivedAt !== null &&
    (!(archivedAt instanceof Date) || Number.isNaN(archivedAt.getTime()))
  ) {
    fail("INVALID_PRODUCT", "archivedAt must be a valid date or null", "archivedAt");
  }
  if (typeof product.active !== "boolean") {
    fail("INVALID_PRODUCT", "active must be a boolean", "active");
  }
  if (product.active && archivedAt !== null) {
    fail("INVALID_PRODUCT", "An archived product cannot remain published", "active");
  }

  const description = product.description;
  if (description !== null && typeof description !== "string") {
    fail("INVALID_PRODUCT", "description must be text or null", "description");
  }
  if (product.agreementText !== null && typeof product.agreementText !== "string") {
    fail("INVALID_PRODUCT", "agreementText must be text or null", "agreementText");
  }
  if (product.agreementText !== null && product.agreementText.length > 20_000) {
    fail(
      "INVALID_PRODUCT",
      "agreementText must be 20,000 characters or fewer",
      "agreementText",
    );
  }

  const normalized: ValidatedStoreProductCommercialInput = Object.freeze({
    name,
    description,
    kind,
    pricingModel,
    priceCents,
    currency: normalizeCurrency(product.currency),
    volumeTiers,
    hourlyRateCents,
    durationMin: assertInteger(product.durationMin, "durationMin", 0, 24 * 60),
    sessionCount: assertInteger(product.sessionCount, "sessionCount", 0, 100),
    deliverables: normalizeDeliverables(product.deliverables),
    locationType: normalizeRequiredText(product.locationType, "locationType", 100),
    bufferMinutes: assertInteger(product.bufferMinutes, "bufferMinutes", 0, 240),
    minLeadHours: assertInteger(product.minLeadHours, "minLeadHours", 0, 30 * 24),
    paymentPlans: normalizePaymentPlans(product.paymentPlans),
    royaltyTerms: normalizeRoyaltyTerms(product.royaltyTerms),
    agreementText: product.agreementText,
    active: product.active,
    archivedAt,
  });

  if (normalized.active && normalized.archivedAt === null) {
    assertSignedInStorePricingSupported(normalized);
    if (effectivePriceCents(normalized) <= 0) {
      fail(
        "PUBLISHED_CASH_PRICE_REQUIRED",
        "Published Store products must have a positive cash price",
        pricingModel === "hourly" ? "hourlyRateCents" : "priceCents",
      );
    }
    if (normalized.pricingModel !== "hourly") {
      assertFeasiblePaymentPlans(normalized);
    }
    const royaltiesUseAgreement =
      normalized.royaltyTerms?.master.mode === "agreement" ||
      normalized.royaltyTerms?.composition.mode === "agreement";
    if (royaltiesUseAgreement && effectiveProducerAgreement(normalized).length === 0) {
      fail(
        "IMMUTABLE_AGREEMENT_REQUIRED",
        "Royalty terms that refer to an agreement require exact inline agreement text",
        "agreementText",
      );
    }
  }

  return normalized;
}

/** Validate a complete product state, applying publication rules when active. */
export function validateStoreProductCommercialState(
  product: StoreProductCommercialInput,
): ValidatedStoreProductCommercialInput {
  return normalizeProduct(product);
}

/** Apply a partial update to the persisted row, then validate the final state. */
export function mergeAndValidateStoreProduct(
  existing: StoreProductCommercialInput,
  patch: StoreProductCommercialPatch,
): ValidatedStoreProductCommercialInput {
  const merged: StoreProductCommercialInput = { ...existing };
  for (const [key, value] of Object.entries(patch) as Array<
    [keyof StoreProductCommercialInput, StoreProductCommercialInput[keyof StoreProductCommercialInput] | undefined]
  >) {
    if (value !== undefined) {
      (merged as Record<keyof StoreProductCommercialInput, unknown>)[key] = value;
    }
  }
  return normalizeProduct(merged);
}

/** Published means artist-visible and not archived; drafts cannot be purchased. */
export function assertPublishedStoreProduct(
  product: StoreProductCommercialInput,
): ValidatedStoreProductCommercialInput {
  const normalized = normalizeProduct(product);
  if (!normalized.active || normalized.archivedAt !== null) {
    fail("PRODUCT_NOT_PUBLISHED", "This Store product is not published");
  }
  assertSignedInStorePricingSupported(normalized);
  return normalized;
}

function formatPercentage(bps: number): string {
  const whole = Math.floor(bps / 100);
  const fraction = bps % 100;
  if (fraction === 0) return `${String(whole)}%`;
  return `${String(whole)}.${String(fraction).padStart(2, "0").replace(/0$/, "")}%`;
}

const ROLE_LABELS: Record<
  "composer" | "lyricist" | "arranger" | "publisher" | "other",
  string
> = {
  composer: "Composer",
  lyricist: "Lyricist",
  arranger: "Arranger",
  publisher: "Publisher",
  other: "Other",
};

/** Deterministic human-readable rights frozen beside structured royalty terms. */
export function deriveStoreProductRights(terms: ProductRoyaltyTerms | null): string[] {
  const normalized = normalizeRoyaltyTerms(terms);
  if (normalized === null) {
    return [
      "Master rights and royalties: not specified.",
      "Composition rights and royalties: not specified.",
    ];
  }

  const master =
    normalized.master.mode === "none"
      ? "Producer receives no master royalty."
      : normalized.master.mode === "agreement"
        ? "Master rights and royalties are defined in this agreement."
        : `Producer receives ${formatPercentage(normalized.master.bps)} master royalty.`;

  const composition = (() => {
    if (normalized.composition.mode === "none") {
      return "Producer receives no composition royalty.";
    }
    if (normalized.composition.mode === "agreement") {
      return "Composition rights and royalties are defined in this agreement.";
    }
    const role = normalized.composition.role
      ? ` as ${ROLE_LABELS[normalized.composition.role]}`
      : "";
    const society = normalized.composition.collectingSociety
      ? ` (${normalized.composition.collectingSociety})`
      : "";
    return `Producer receives ${formatPercentage(normalized.composition.bps)} composition royalty${role}${society}.`;
  })();

  return [master, composition, ...(normalized.notes ? [`Rights notes: ${normalized.notes}`] : [])];
}

function multiplyMoney(left: number, right: number, label: string): number {
  const result = BigInt(left) * BigInt(right);
  if (result > BigInt(MAX_POSTGRES_INTEGER)) {
    fail("PRICE_OVERFLOW", `${label} exceeds the maximum supported purchase amount`);
  }
  return Number(result);
}

function addMoney(left: number, right: number, label: string): number {
  const result = BigInt(left) + BigInt(right);
  if (result > BigInt(MAX_POSTGRES_INTEGER)) {
    fail("PRICE_OVERFLOW", `${label} exceeds the maximum supported purchase amount`);
  }
  return Number(result);
}

function roundRatio(value: number, multiplier: number, denominator: number, label: string): number {
  const numerator = BigInt(value) * BigInt(multiplier);
  const divisor = BigInt(denominator);
  const rounded = (numerator * 2n + divisor) / (divisor * 2n);
  if (rounded > BigInt(MAX_POSTGRES_INTEGER)) {
    fail("PRICE_OVERFLOW", `${label} exceeds the maximum supported purchase amount`);
  }
  return Number(rounded);
}

function normalizeTax(mode: string, ratePct: number): { mode: TaxMode; ratePct: number } {
  if (mode !== "tax_free" && mode !== "tax_included" && mode !== "tax_added") {
    fail("INVALID_TAX", "Tax mode is unsupported", "taxMode");
  }
  if (!Number.isSafeInteger(ratePct) || ratePct < 0 || ratePct > 100) {
    fail("INVALID_TAX", "Tax rate must be a whole percentage from 0 to 100", "taxRatePct");
  }
  return { mode, ratePct };
}

function taxFor(
  subtotalCents: number,
  taxMode: string,
  taxRatePct: number,
): PurchaseCommercialSnapshot["tax"] & { totalCents: number } {
  const tax = normalizeTax(taxMode, taxRatePct);
  if (tax.mode === "tax_free") {
    return { ...tax, amountCents: 0, totalCents: subtotalCents };
  }
  if (tax.mode === "tax_included") {
    return {
      ...tax,
      amountCents: roundRatio(
        subtotalCents,
        tax.ratePct,
        100 + tax.ratePct,
        "Included tax",
      ),
      totalCents: subtotalCents,
    };
  }
  const amountCents = roundRatio(subtotalCents, tax.ratePct, 100, "Added tax");
  return {
    ...tax,
    amountCents,
    totalCents: addMoney(subtotalCents, amountCents, "Purchase total"),
  };
}

function requestedQuantity(
  product: ValidatedStoreProductCommercialInput,
  requestedSongQty: number | null | undefined,
): number | null {
  if (product.pricingModel !== "per_song") {
    if (requestedSongQty !== null && requestedSongQty !== undefined) {
      fail(
        "INVALID_SONG_QUANTITY",
        "Song quantity is accepted only for per-song products",
        "requestedSongQty",
      );
    }
    return null;
  }
  if (
    typeof requestedSongQty !== "number" ||
    !Number.isSafeInteger(requestedSongQty) ||
    requestedSongQty < 1 ||
    requestedSongQty > MAX_STORE_SONG_QUANTITY
  ) {
    fail(
      "INVALID_SONG_QUANTITY",
      `Per-song purchases require a quantity from 1 to ${String(MAX_STORE_SONG_QUANTITY)}`,
      "requestedSongQty",
    );
  }
  return requestedSongQty;
}

function selectedPlan(
  raw: PaymentPlan,
  offered: readonly PaymentPlan[],
): PaymentPlan {
  const selected = normalizePlan(raw, "selectedPaymentPlan");
  if (!offered.some((plan) => planKey(plan) === planKey(selected))) {
    fail(
      "PAYMENT_PLAN_NOT_OFFERED",
      "The selected payment plan is not enabled for this product",
      "selectedPaymentPlan",
    );
  }
  return selected;
}

function lineItemFor(
  product: ValidatedStoreProductCommercialInput,
  songQty: number | null,
): {
  lineItem: PurchaseCommercialSnapshot["lineItems"][number];
  listSubtotalCents: number;
  discountCents: number;
  subtotalCents: number;
} {
  if (product.pricingModel === "per_song") {
    if (songQty === null) fail("INVALID_SONG_QUANTITY", "Song quantity is required");
    const baseTier = product.volumeTiers[0];
    if (!baseTier) fail("INVALID_VOLUME_TIERS", "A base volume tier is required");
    let activeTier = baseTier;
    for (const tier of product.volumeTiers) {
      if (songQty >= tier.minQty) activeTier = tier;
    }
    const listSubtotalCents = multiplyMoney(
      songQty,
      baseTier.pricePerUnitCents,
      "List subtotal",
    );
    const subtotalCents = multiplyMoney(
      songQty,
      activeTier.pricePerUnitCents,
      "Subtotal",
    );
    return {
      lineItem: {
        label: product.name,
        quantity: songQty,
        listUnitPriceCents: baseTier.pricePerUnitCents,
        unitPriceCents: activeTier.pricePerUnitCents,
        totalCents: subtotalCents,
      },
      listSubtotalCents,
      discountCents: listSubtotalCents - subtotalCents,
      subtotalCents,
    };
  }

  const unitPriceCents = effectivePriceCents(product);
  return {
    lineItem: {
      label: product.name,
      quantity: 1,
      listUnitPriceCents: unitPriceCents,
      unitPriceCents,
      totalCents: unitPriceCents,
    },
    listSubtotalCents: unitPriceCents,
    discountCents: 0,
    subtotalCents: unitPriceCents,
  };
}

function money(cents: number, currency: string): string {
  const value = BigInt(cents);
  const whole = value / 100n;
  const minor = value % 100n;
  return `${currency} ${String(whole)}.${String(minor).padStart(2, "0")}`;
}

function planLabel(plan: PaymentPlan): string {
  if (plan.kind === "full") return "Full payment";
  if (plan.kind === "split_50_50") return "50/50";
  return `Monthly (${String(plan.installments)} installments)`;
}

function limitLabel(limit: { kind: "fixed"; count: number } | { kind: "unlimited" }): string {
  return limit.kind === "unlimited" ? "Unlimited" : String(limit.count);
}

function finalAgreementText(
  snapshot: Omit<PurchaseCommercialSnapshot, "agreementText">,
  producerTerms: string,
  paymentPlanLabelOverride?: string,
): string {
  const item = snapshot.lineItems[0];
  if (!item) fail("INVALID_PRODUCT", "A purchase must contain a line item");
  const lines = [
    "Skitza purchase agreement",
    `Product: ${snapshot.productOrOfferName}`,
    ...(snapshot.tagline ? [`Tagline: ${snapshot.tagline}`] : []),
    ...(snapshot.service ? [`Service: ${snapshot.service}`] : []),
    `Quantity: ${String(item.quantity)}`,
    `List unit price: ${money(item.listUnitPriceCents, snapshot.currency)}`,
    `Unit price: ${money(item.unitPriceCents, snapshot.currency)}`,
    `List subtotal: ${money(snapshot.listSubtotalCents, snapshot.currency)}`,
    `Volume discount: ${money(snapshot.discountCents, snapshot.currency)}`,
    `Subtotal: ${money(snapshot.subtotalCents, snapshot.currency)}`,
    `Tax: ${snapshot.tax.mode} at ${String(snapshot.tax.ratePct)}% (${money(snapshot.tax.amountCents, snapshot.currency)})`,
    `Total: ${money(snapshot.totalCents, snapshot.currency)}`,
    `Payment plan: ${paymentPlanLabelOverride ?? (snapshot.selectedPaymentPlan ? planLabel(snapshot.selectedPaymentPlan) : "None")}`,
    `Included song spaces: ${String(snapshot.includedSongSpaces)}`,
    `Deliverables: ${snapshot.deliverables.length > 0 ? snapshot.deliverables.join("; ") : "None specified"}`,
    `Sessions: ${snapshot.session ? `${limitLabel(snapshot.session.limit)} × ${String(snapshot.session.durationMin)} minutes (${snapshot.session.locationType}; ${String(snapshot.session.bufferMinutes)}-minute buffer; ${String(snapshot.session.minLeadHours)}-hour lead time)` : "None"}`,
    `Revisions: ${snapshot.revisionRule ? limitLabel(snapshot.revisionRule) : "Not specified"}`,
    "Rights:",
    ...snapshot.rights.map((right) => `- ${right}`),
    "Additional producer terms:",
    producerTerms || "None.",
  ];
  return lines.join("\n");
}

/**
 * Render the canonical Store agreement before an artist has selected a plan.
 * Keeping this beside the accepted-agreement renderer prevents request previews
 * from reconstructing or editing commercially significant text by position.
 */
export function buildStorePurchaseProposalAgreementText(
  snapshot: PurchaseCommercialSnapshot,
  product: StoreProductCommercialInput,
): string {
  const proposalSnapshot = {
    ...snapshot,
    selectedPaymentPlan: null,
  } satisfies PurchaseCommercialSnapshot;
  return finalAgreementText(
    proposalSnapshot,
    effectiveProducerAgreement(product),
    "Not selected yet",
  );
}

export type BuildStorePurchaseSnapshotInput = Readonly<{
  product: StoreProductCommercialInput;
  requestedSongQty: number | null | undefined;
  taxMode: string;
  taxRatePct: number;
  selectedPaymentPlan: PaymentPlan;
}>;

export type BuiltStorePurchaseSnapshot = Readonly<{
  snapshot: PurchaseCommercialSnapshot;
  snapshotDigest: string;
}>;

/**
 * Build the only accepted Store snapshot shape. Callers provide a product,
 * song selection, producer tax settings, and one plan identifier; prices,
 * discounts, tax, totals, rights, and agreement copy are all recomputed here.
 */
export function buildStorePurchaseSnapshot(
  input: BuildStorePurchaseSnapshotInput,
): BuiltStorePurchaseSnapshot {
  const product = normalizeProduct(input.product);
  if (!product.active || product.archivedAt !== null) {
    fail("PRODUCT_NOT_PUBLISHED", "This Store product is not published");
  }
  assertSignedInStorePricingSupported(product);
  const songQty = requestedQuantity(product, input.requestedSongQty);
  const paymentPlan = selectedPlan(input.selectedPaymentPlan, product.paymentPlans);
  const price = lineItemFor(product, songQty);
  const tax = taxFor(price.subtotalCents, input.taxMode, input.taxRatePct);
  const decoded = decodeDescription(product.description);
  const royaltyTerms = normalizeRoyaltyTerms(product.royaltyTerms);
  const rights = deriveStoreProductRights(royaltyTerms);
  const session: PurchaseCommercialSnapshot["session"] =
    product.durationMin === 0
      ? null
      : {
          limit:
            product.sessionCount === 0
              ? { kind: "unlimited" }
              : { kind: "fixed", count: product.sessionCount },
          durationMin: product.durationMin,
          locationType: product.locationType,
          bufferMinutes: product.bufferMinutes,
          minLeadHours: product.minLeadHours,
        };
  const revisionRule: PurchaseCommercialSnapshot["revisionRule"] = decoded.unlimitedRevisions
    ? { kind: "unlimited" }
    : { kind: "fixed", count: decoded.revisions };
  const includedSongSpaces =
    product.pricingModel === "per_song"
      ? (songQty ?? 0)
      : product.pricingModel === "hourly" || product.kind === "session" || product.kind === "hourly"
        ? 0
        : 1;

  const withoutAgreement: Omit<PurchaseCommercialSnapshot, "agreementText"> = {
    version: 1,
    productOrOfferName: product.name,
    ...(decoded.tagline.trim() ? { tagline: decoded.tagline.trim() } : {}),
    service: product.kind,
    deliverables: [...product.deliverables],
    lineItems: [{ ...price.lineItem }],
    listSubtotalCents: price.listSubtotalCents,
    discountCents: price.discountCents,
    subtotalCents: price.subtotalCents,
    tax: {
      mode: tax.mode,
      ratePct: tax.ratePct,
      amountCents: tax.amountCents,
    },
    totalCents: tax.totalCents,
    currency: product.currency,
    includedSongSpaces,
    session,
    revisionRule,
    royaltyTerms,
    rights,
    selectedPaymentPlan: paymentPlan,
    offeredPaymentPlans: product.paymentPlans.map((plan) => ({ ...plan })),
  };
  const snapshot: PurchaseCommercialSnapshot = {
    ...withoutAgreement,
    agreementText: finalAgreementText(withoutAgreement, effectiveProducerAgreement(product)),
  };
  assertCommercialSnapshotMatchesAcceptance(snapshot, snapshot.totalCents, paymentPlan);
  return Object.freeze({
    snapshot,
    snapshotDigest: digestCommercialSnapshot(snapshot),
  });
}
