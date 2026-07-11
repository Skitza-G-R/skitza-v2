import type { ProductRoyaltyTerms } from "@skitza/db";

const ROLE_LABELS: Record<NonNullable<Extract<
  ProductRoyaltyTerms["composition"],
  { mode: "percentage" }
>["role"]>, string> = {
  composer: "Composer",
  lyricist: "Lyricist",
  arranger: "Arranger",
  publisher: "Publisher",
  other: "Other",
};

export function formatRoyaltyPercentage(bps: number): string {
  const value = (bps / 100).toFixed(2).replace(/\.00$/, "").replace(/(\.\d)0$/, "$1");
  return `${value}%`;
}

export type RoyaltyTermsDisplay = {
  specified: boolean;
  master: string;
  composition: string;
};

export function royaltyTermsDisplay(
  terms: ProductRoyaltyTerms | null | undefined,
): RoyaltyTermsDisplay {
  if (!terms) {
    return {
      specified: false,
      master: "Not specified",
      composition: "Not specified",
    };
  }

  const master = (() => {
    if (terms.master.mode === "none") return "No master royalty";
    if (terms.master.mode === "agreement") return "Defined in the agreement";
    return `${formatRoyaltyPercentage(terms.master.bps)} master royalty`;
  })();

  const composition = (() => {
    if (terms.composition.mode === "none") return "No composition royalty";
    if (terms.composition.mode === "agreement") return "Defined in the agreement";
    const context = [
      terms.composition.role ? ROLE_LABELS[terms.composition.role] : null,
      terms.composition.collectingSociety?.trim() || null,
    ].filter((part): part is string => Boolean(part));
    const base = `${formatRoyaltyPercentage(terms.composition.bps)} composition royalty`;
    return context.length > 0 ? `${base} · ${context.join(" · ")}` : base;
  })();

  return { specified: true, master, composition };
}
