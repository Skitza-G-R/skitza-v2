import type { PurchaseCommercialSnapshot } from "@skitza/db";

import type { PurchasePaymentPlan } from "./ledger";

type JsonRecord = Record<string, unknown>;

const SNAPSHOT_KEYS = [
  "version",
  "bookingEnabled",
  "productOrOfferName",
  "tagline",
  "service",
  "deliverables",
  "lineItems",
  "listSubtotalCents",
  "discountCents",
  "subtotalCents",
  "tax",
  "totalCents",
  "currency",
  "includedSongSpaces",
  "session",
  "revisionRule",
  "royaltyTerms",
  "rights",
  "selectedPaymentPlan",
  "offeredPaymentPlans",
  "agreementText",
] as const;

const REQUIRED_SNAPSHOT_KEYS = SNAPSHOT_KEYS.filter(
  (key) => key !== "tagline" && key !== "service" && key !== "bookingEnabled",
);

function record(value: unknown, label: string): JsonRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  const prototype = Object.getPrototypeOf(value) as object | null;
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error(`${label} must be a plain object`);
  }
  if (Object.getOwnPropertySymbols(value).length > 0) {
    throw new Error(`${label} must use string keys only`);
  }
  return value as JsonRecord;
}

function exactKeys(
  value: JsonRecord,
  allowed: readonly string[],
  required: readonly string[],
  label: string,
): void {
  const allowedKeys = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) {
      throw new Error(`${label} contains an unsupported field: ${key}`);
    }
  }
  for (const key of required) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) {
      throw new Error(`${label} is missing ${key}`);
    }
  }
}

function stringValue(value: unknown, label: string, nonEmpty = false): string {
  if (typeof value !== "string" || (nonEmpty && value.trim().length === 0)) {
    throw new Error(`${label} must be ${nonEmpty ? "a non-empty string" : "a string"}`);
  }
  return value;
}

function safeInteger(
  value: unknown,
  label: string,
  minimum: number,
  maximum = Number.MAX_SAFE_INTEGER,
): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    throw new Error(
      `${label} must be a safe integer between ${String(minimum)} and ${String(maximum)}`,
    );
  }
  return value;
}

function denseArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  for (let index = 0; index < value.length; index += 1) {
    if (!(index in value)) throw new Error(`${label} must not contain sparse entries`);
  }
  return value;
}

function stringArray(value: unknown, label: string): string[] {
  return denseArray(value, label).map((entry, index) =>
    stringValue(entry, `${label}[${String(index)}]`),
  );
}

function addSafe(left: number, right: number, label: string): number {
  const value = left + right;
  if (!Number.isSafeInteger(value)) throw new Error(`${label} exceeds safe integer cents`);
  return value;
}

function multiplySafe(left: number, right: number, label: string): number {
  const value = left * right;
  if (!Number.isSafeInteger(value)) throw new Error(`${label} exceeds safe integer cents`);
  return value;
}

function roundSafeRatio(
  value: number,
  multiplier: number,
  denominator: number,
  label: string,
): number {
  const numerator = BigInt(value) * BigInt(multiplier);
  const divisor = BigInt(denominator);
  const rounded = (numerator * 2n + divisor) / (divisor * 2n);
  const result = Number(rounded);
  if (!Number.isSafeInteger(result)) throw new Error(`${label} exceeds safe integer cents`);
  return result;
}

function paymentPlanKey(value: unknown, label: string): string {
  const plan = record(value, label);
  if (plan.kind === "full" || plan.kind === "split_50_50") {
    exactKeys(plan, ["kind"], ["kind"], label);
    return plan.kind;
  }
  if (plan.kind === "monthly") {
    exactKeys(plan, ["kind", "installments"], ["kind", "installments"], label);
    const installments = safeInteger(plan.installments, `${label}.installments`, 2, 12);
    return `monthly:${String(installments)}`;
  }
  throw new Error(`${label} has an unsupported payment-plan kind`);
}

function acceptedPlanKey(plan: PurchasePaymentPlan | null): string | null {
  return plan === null ? null : paymentPlanKey(plan, "accepted payment plan");
}

function validateLineItems(value: unknown): {
  listSubtotalCents: number;
  subtotalCents: number;
} {
  let listSubtotalCents = 0;
  let subtotalCents = 0;
  for (const [index, rawItem] of denseArray(value, "commercialSnapshot.lineItems").entries()) {
    const label = `commercialSnapshot.lineItems[${String(index)}]`;
    const item = record(rawItem, label);
    exactKeys(
      item,
      ["label", "quantity", "listUnitPriceCents", "unitPriceCents", "totalCents"],
      ["label", "quantity", "listUnitPriceCents", "unitPriceCents", "totalCents"],
      label,
    );
    stringValue(item.label, `${label}.label`, true);
    const quantity = safeInteger(item.quantity, `${label}.quantity`, 1);
    const listUnitPriceCents = safeInteger(
      item.listUnitPriceCents,
      `${label}.listUnitPriceCents`,
      0,
    );
    const unitPriceCents = safeInteger(item.unitPriceCents, `${label}.unitPriceCents`, 0);
    const totalCents = safeInteger(item.totalCents, `${label}.totalCents`, 0);
    if (listUnitPriceCents < unitPriceCents) {
      throw new Error(`${label}.listUnitPriceCents cannot be lower than unitPriceCents`);
    }
    if (multiplySafe(quantity, unitPriceCents, `${label}.totalCents`) !== totalCents) {
      throw new Error(`${label}.totalCents must equal quantity times unitPriceCents`);
    }
    listSubtotalCents = addSafe(
      listSubtotalCents,
      multiplySafe(quantity, listUnitPriceCents, `${label}.listSubtotalCents`),
      "commercial snapshot list subtotal",
    );
    subtotalCents = addSafe(subtotalCents, totalCents, "commercial snapshot subtotal");
  }
  return { listSubtotalCents, subtotalCents };
}

function validateTax(value: unknown, subtotalCents: number, totalCents: number): void {
  const tax = record(value, "commercialSnapshot.tax");
  exactKeys(
    tax,
    ["mode", "ratePct", "amountCents"],
    ["mode", "ratePct", "amountCents"],
    "commercialSnapshot.tax",
  );
  const ratePct = safeInteger(tax.ratePct, "commercialSnapshot.tax.ratePct", 0, 100);
  const amountCents = safeInteger(tax.amountCents, "commercialSnapshot.tax.amountCents", 0);
  if (tax.mode !== "tax_free" && tax.mode !== "tax_included" && tax.mode !== "tax_added") {
    throw new Error("commercialSnapshot.tax.mode is unsupported");
  }
  if (tax.mode === "tax_added") {
    const expectedTax = roundSafeRatio(subtotalCents, ratePct, 100, "Tax-added amount");
    if (expectedTax !== amountCents) {
      throw new Error("Tax-added amount must match subtotal and rate");
    }
    if (addSafe(subtotalCents, amountCents, "commercial snapshot total") !== totalCents) {
      throw new Error("Tax-added total must equal subtotal plus tax");
    }
    return;
  }
  if (totalCents !== subtotalCents) {
    throw new Error("Tax-free and tax-included totals must equal the displayed subtotal");
  }
  if (tax.mode === "tax_free" && amountCents !== 0) {
    throw new Error("Tax-free commercial terms cannot include a tax amount");
  }
  if (tax.mode === "tax_included") {
    const expectedTax = roundSafeRatio(totalCents, ratePct, 100 + ratePct, "Included-tax amount");
    if (amountCents !== expectedTax) {
      throw new Error("Included-tax amount must match gross total and rate");
    }
  }
}

function validateLimit(value: unknown, label: string, allowZero: boolean): void {
  const limit = record(value, label);
  if (limit.kind === "unlimited") {
    exactKeys(limit, ["kind"], ["kind"], label);
    return;
  }
  if (limit.kind === "fixed") {
    exactKeys(limit, ["kind", "count"], ["kind", "count"], label);
    safeInteger(limit.count, `${label}.count`, allowZero ? 0 : 1);
    return;
  }
  throw new Error(`${label}.kind is unsupported`);
}

function validateSession(value: unknown): void {
  if (value === null) return;
  const session = record(value, "commercialSnapshot.session");
  exactKeys(
    session,
    ["limit", "durationMin", "locationType", "bufferMinutes", "minLeadHours"],
    ["limit", "durationMin", "locationType", "bufferMinutes", "minLeadHours"],
    "commercialSnapshot.session",
  );
  validateLimit(session.limit, "commercialSnapshot.session.limit", false);
  safeInteger(session.durationMin, "commercialSnapshot.session.durationMin", 1);
  stringValue(session.locationType, "commercialSnapshot.session.locationType", true);
  safeInteger(session.bufferMinutes, "commercialSnapshot.session.bufferMinutes", 0);
  safeInteger(session.minLeadHours, "commercialSnapshot.session.minLeadHours", 0);
}

function validateRevisionRule(value: unknown): void {
  if (value === null) return;
  validateLimit(value, "commercialSnapshot.revisionRule", true);
}

function validateRoyaltyPart(value: unknown, label: string, composition: boolean): void {
  const part = record(value, label);
  if (part.mode === "none" || part.mode === "agreement") {
    exactKeys(part, ["mode"], ["mode"], label);
    return;
  }
  if (part.mode !== "percentage") throw new Error(`${label}.mode is unsupported`);
  const allowed = composition ? ["mode", "bps", "role", "collectingSociety"] : ["mode", "bps"];
  exactKeys(part, allowed, ["mode", "bps"], label);
  safeInteger(part.bps, `${label}.bps`, 0, 10_000);
  if (Object.prototype.hasOwnProperty.call(part, "role")) {
    if (
      part.role !== "composer" &&
      part.role !== "lyricist" &&
      part.role !== "arranger" &&
      part.role !== "publisher" &&
      part.role !== "other"
    ) {
      throw new Error(`${label}.role is unsupported`);
    }
  }
  if (Object.prototype.hasOwnProperty.call(part, "collectingSociety")) {
    stringValue(part.collectingSociety, `${label}.collectingSociety`);
  }
}

function validateRoyaltyTerms(value: unknown): void {
  if (value === null) return;
  const terms = record(value, "commercialSnapshot.royaltyTerms");
  exactKeys(
    terms,
    ["master", "composition", "notes"],
    ["master", "composition"],
    "commercialSnapshot.royaltyTerms",
  );
  validateRoyaltyPart(terms.master, "commercialSnapshot.royaltyTerms.master", false);
  validateRoyaltyPart(terms.composition, "commercialSnapshot.royaltyTerms.composition", true);
  if (Object.prototype.hasOwnProperty.call(terms, "notes")) {
    stringValue(terms.notes, "commercialSnapshot.royaltyTerms.notes");
  }
}

export function assertCommercialSnapshotMatchesAcceptance(
  snapshot: unknown,
  acceptedTotalCents: number,
  acceptedPlan: PurchasePaymentPlan | null,
): asserts snapshot is PurchaseCommercialSnapshot {
  const candidate = record(snapshot, "commercialSnapshot");
  if (candidate.version !== 1 && candidate.version !== 2) {
    throw new Error("commercialSnapshot.version must be 1 or 2");
  }
  exactKeys(
    candidate,
    SNAPSHOT_KEYS,
    candidate.version === 2
      ? [...REQUIRED_SNAPSHOT_KEYS, "bookingEnabled"]
      : REQUIRED_SNAPSHOT_KEYS,
    "commercialSnapshot",
  );
  if (candidate.version === 1) {
    if (Object.prototype.hasOwnProperty.call(candidate, "bookingEnabled")) {
      throw new Error("Legacy commercial snapshots cannot declare booking eligibility");
    }
  } else {
    if (typeof candidate.bookingEnabled !== "boolean") {
      throw new Error("commercialSnapshot.bookingEnabled must be a boolean");
    }
    if ((candidate.session !== null) !== candidate.bookingEnabled) {
      throw new Error(
        "commercialSnapshot.session must be present exactly when booking is enabled",
      );
    }
  }
  stringValue(candidate.productOrOfferName, "commercialSnapshot.productOrOfferName", true);
  if (Object.prototype.hasOwnProperty.call(candidate, "tagline")) {
    stringValue(candidate.tagline, "commercialSnapshot.tagline");
  }
  if (Object.prototype.hasOwnProperty.call(candidate, "service")) {
    stringValue(candidate.service, "commercialSnapshot.service");
  }
  stringArray(candidate.deliverables, "commercialSnapshot.deliverables");

  const lineItemTotals = validateLineItems(candidate.lineItems);
  const listSubtotalCents = safeInteger(
    candidate.listSubtotalCents,
    "commercialSnapshot.listSubtotalCents",
    0,
  );
  const discountCents = safeInteger(
    candidate.discountCents,
    "commercialSnapshot.discountCents",
    0,
  );
  const subtotalCents = safeInteger(candidate.subtotalCents, "commercialSnapshot.subtotalCents", 0);
  if (lineItemTotals.listSubtotalCents !== listSubtotalCents) {
    throw new Error("Commercial snapshot line items must sum to listSubtotalCents");
  }
  if (lineItemTotals.subtotalCents !== subtotalCents) {
    throw new Error("Commercial snapshot line items must sum to subtotalCents");
  }
  if (discountCents > listSubtotalCents || listSubtotalCents - discountCents !== subtotalCents) {
    throw new Error("Commercial snapshot discount must bridge list subtotal to net subtotal");
  }
  const totalCents = safeInteger(candidate.totalCents, "commercialSnapshot.totalCents", 0);
  if (totalCents !== acceptedTotalCents) {
    throw new Error("Commercial snapshot total must match the accepted purchase total");
  }
  validateTax(candidate.tax, subtotalCents, totalCents);
  stringValue(candidate.currency, "commercialSnapshot.currency", true);
  safeInteger(candidate.includedSongSpaces, "commercialSnapshot.includedSongSpaces", 0);
  validateSession(candidate.session);
  validateRevisionRule(candidate.revisionRule);
  validateRoyaltyTerms(candidate.royaltyTerms);
  stringArray(candidate.rights, "commercialSnapshot.rights");
  stringValue(candidate.agreementText, "commercialSnapshot.agreementText", true);

  const offeredPlans = denseArray(
    candidate.offeredPaymentPlans,
    "commercialSnapshot.offeredPaymentPlans",
  );
  const offeredKeys = offeredPlans.map((offered, index) =>
    paymentPlanKey(offered, `commercialSnapshot.offeredPaymentPlans[${String(index)}]`),
  );
  if (new Set(offeredKeys).size !== offeredKeys.length) {
    throw new Error("Commercial snapshot contains duplicate payment-plan options");
  }

  const acceptedKey = acceptedPlanKey(acceptedPlan);
  if (totalCents === 0) {
    if (candidate.selectedPaymentPlan !== null || acceptedKey !== null) {
      throw new Error("A zero-total commercial snapshot must not select a payment plan");
    }
    if (offeredKeys.length !== 0) {
      throw new Error("A zero-total commercial snapshot must not offer a payment plan");
    }
    return;
  }
  if (candidate.selectedPaymentPlan === null || acceptedKey === null) {
    throw new Error("A positive-total commercial snapshot must select an approved payment plan");
  }
  const selectedKey = paymentPlanKey(
    candidate.selectedPaymentPlan,
    "commercialSnapshot.selectedPaymentPlan",
  );
  if (selectedKey !== acceptedKey) {
    throw new Error("Commercial snapshot payment plan must match the accepted schedule");
  }
  if (!offeredKeys.includes(selectedKey)) {
    throw new Error("Commercial snapshot payment plan must be one of the approved options");
  }
}
