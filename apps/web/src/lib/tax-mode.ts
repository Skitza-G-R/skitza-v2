// tax-mode.ts
//
// Tax v2 — business-level disclosure mode + rate. Three modes:
//
//   * 'tax_free'     — no tax line, no math change.
//   * 'tax_included' — listed prices include `taxRatePct%`. Footnote
//                      reads "Includes {rate}% tax." No math change at
//                      checkout — the displayed number IS the total.
//   * 'tax_added'    — listed prices are PRE-TAX. Stripe is charged
//                      `price × (1 + rate/100)`. Footnote reads
//                      "+ {rate}% tax at checkout." The Pricing step's
//                      live preview shows the post-tax amount.
//
// `taxRatePct` is a whole-number integer (e.g. 18 for Israeli VAT,
// 20 for UK VAT). Fractional rates aren't supported in v2 — the UI
// input is integer-only.
//
// Pure module: no React, no DB. Safe to import from server actions,
// tRPC routers, server components, and client components alike.

export const TAX_MODES = ["tax_free", "tax_included", "tax_added"] as const;
export type TaxMode = (typeof TAX_MODES)[number];

export function isTaxMode(v: unknown): v is TaxMode {
  return (
    typeof v === "string" && (TAX_MODES as readonly string[]).includes(v)
  );
}

// Normalise loose strings (from the DB free-text column or legacy
// shapes) into a known mode. Anything unrecognised collapses to
// 'tax_free' so we never crash a render on a stale value.
export function coerceTaxMode(v: unknown): TaxMode {
  if (isTaxMode(v)) return v;
  // Pre-migration-0019 values get folded into the new shape so
  // callers reading directly from the DB before a migrate-apply
  // window don't see broken UI.
  if (v === "none" || v === "vat_exempt") return "tax_free";
  if (v === "vat_included") return "tax_included";
  return "tax_free";
}

// Short label used on the segmented toggle button. Three short
// noun phrases — no jargon, no parens, no em-dashes.
export function taxModeOptionLabel(mode: TaxMode): string {
  switch (mode) {
    case "tax_free":
      return "Tax-free";
    case "tax_included":
      return "Tax included";
    case "tax_added":
      return "Plus tax";
  }
}

// One-sentence hint under the picker explaining what the mode means
// in plain English. Used in Settings under the segmented control.
export function taxModeHint(mode: TaxMode, ratePct: number): string {
  switch (mode) {
    case "tax_free":
      return "Artists see no tax line. Pick this if you're VAT-exempt or sell outside a VAT region.";
    case "tax_included":
      return `Your listed price already includes ${String(ratePct)}% tax. Artists pay exactly the number you typed.`;
    case "tax_added":
      return `Your listed price is pre-tax. ${String(ratePct)}% is added at checkout, so artists pay more than the number you typed.`;
  }
}

// Artist-facing footnote rendered next to every price on the
// storefront and product pages. `null` means "render no footnote."
export function taxModeFootnote(
  mode: TaxMode,
  ratePct: number,
): string | null {
  switch (mode) {
    case "tax_free":
      return "Tax-free";
    case "tax_included":
      return `Includes ${String(ratePct)}% tax`;
    case "tax_added":
      return `+ ${String(ratePct)}% tax at checkout`;
  }
}

// Live tax preview shown to the producer in the Pricing step of the
// product editor. Educates them on what the artist sees AND pays for
// the price they typed.
//
// `displayPrice` is the producer-entered amount in the same currency
// the editor shows (already prefixed with $/€/etc. by the caller).
// `displayPostTax` is the post-tax amount the artist actually pays
// (only differs from displayPrice for tax_added). The caller formats
// both — this helper just composes the sentence.
export function taxModePricingNote(
  mode: TaxMode,
  ratePct: number,
  displayPrice: string,
  displayPostTax: string,
): string {
  switch (mode) {
    case "tax_free":
      return `Tax-free. Artists pay ${displayPrice}.`;
    case "tax_included":
      return `Includes ${String(ratePct)}% tax. Artists pay ${displayPrice}.`;
    case "tax_added":
      return `Plus ${String(ratePct)}% tax. Artists pay ${displayPostTax} at checkout.`;
  }
}

// Compute the checkout-time multiplier for the producer's tax mode.
// 1.0 for everything except `tax_added`, which returns 1 + rate/100.
// Used by checkout-initiator to scale the Stripe charge for per-song
// AND flat products in one place.
export function taxCheckoutMultiplier(
  mode: TaxMode,
  ratePct: number,
): number {
  if (mode !== "tax_added") return 1;
  // Clamp rate to [0, 100] defensively — the UI bounds the input but
  // a hand-crafted DB write could land outside.
  const safe = Math.max(0, Math.min(100, ratePct));
  return 1 + safe / 100;
}

// Apply the tax multiplier to a cents amount and round to the nearest
// integer cent. Use this anywhere the checkout total or invoice line
// needs the after-tax number.
export function applyTaxToCents(
  cents: number,
  mode: TaxMode,
  ratePct: number,
): number {
  return Math.round(cents * taxCheckoutMultiplier(mode, ratePct));
}
