// tax-mode.ts
//
// Business-level VAT / tax disclosure mode. Lives on the producer
// row (not per-product) because it's a legal-status fact, not a
// pricing decision. Three modes for v1 — see migration 0018 for the
// schema rationale.
//
// All three modes display the same number as the buyer pays; only
// the disclosure label differs. The 'vat_added' mode (which DOES
// change checkout totals by multiplying by 1.18) is intentionally
// deferred — v1 IL producers overwhelmingly price all-in.
//
// Pure module: no React, no DB. Safe to import from server actions,
// tRPC routers, server components, and client components alike.

export const TAX_MODES = ["none", "vat_included", "vat_exempt"] as const;
export type TaxMode = (typeof TAX_MODES)[number];

export function isTaxMode(v: unknown): v is TaxMode {
  return (
    typeof v === "string" && (TAX_MODES as readonly string[]).includes(v)
  );
}

// Settings-side picker label (the option text the producer sees).
// Short, plain English. The Israeli term in parens is the audience cue.
export function taxModeOptionLabel(mode: TaxMode): string {
  switch (mode) {
    case "none":
      return "No tax line";
    case "vat_included":
      return "Prices include 18% VAT";
    case "vat_exempt":
      return "VAT exempt (Osek Patur)";
  }
}

// Settings-side picker sub-label / explainer. Single short sentence.
export function taxModeOptionSubLabel(mode: TaxMode): string {
  switch (mode) {
    case "none":
      return "Most non-Israeli producers pick this.";
    case "vat_included":
      return "For עוסק מורשה. Footnote shown to artists.";
    case "vat_exempt":
      return "For עוסק פטור. Footnote shown to artists.";
  }
}

// Artist-facing footnote rendered next to every price on the storefront
// and product pages. `null` means "no footnote" (mode='none').
export function taxModeFootnote(mode: TaxMode): string | null {
  switch (mode) {
    case "none":
      return null;
    case "vat_included":
      return "Includes 18% VAT";
    case "vat_exempt":
      return "Exempt from VAT (Osek Patur)";
  }
}
