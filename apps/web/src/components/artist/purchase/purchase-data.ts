// Types + display helpers for the artist purchase flow (Commit section).
//
// The shapes mirror BE-1's contract (SK-37): the route pages fetch the real
// product + producer via tRPC (`artist.store.product`), map them with
// `~/lib/purchase/product-mapping`, and pass these shapes down — the screens
// stay data-only.

export type PurchaseProduct = {
  id: string;
  name: string;
  /** Price-locked snapshot, in agorot (₪1 = 100). */
  priceCents: number;
  currency: string;
  /** Human duration label, e.g. "3 sessions · 2h each". */
  durationLabel: string;
  /** What the booking covers — the agreement's "What's included" list. */
  includes: string[];
  /** Wizard tagline (decoded from description) — null when unset. */
  tagline: string | null;
  /** Session count — the ticket card's right column. */
  sessions: number;
  /** Upfront deposit % (0 = none) — ticket card's right column. */
  depositPct: number;
  /** Revision rounds from the wizard encoding (0 = not specified). */
  revisions: number;
  /** Offered plan kinds (handoff-4 S3 plan-hint chips). */
  planKinds: ("full" | "split_50_50" | "monthly" | "milestones")[];
};

export type Producer = {
  name: string;
  initials: string;
  /** Cover-gradient hue so the booking thumbnail matches the store. */
  hue: number;
  /** The uploaded Booking_Agreement.pdf — null when none is uploaded.
      `url` opens the PDF itself (S4's View pill); optional for mocks. */
  agreement: { filename: string; url?: string } | null;
};

export type AgreementTerm = {
  heading: string;
  body: string;
  points?: string[];
};

// ₪ formatting — whole-shekel display, grouped thousands.
export function formatShekels(priceCents: number): string {
  return "₪" + Math.round(priceCents / 100).toLocaleString("en-US");
}

// Cover-art gradients (match the store's oklch covers) so the booking
// thumbnail reads like the record-shelf store. `swatch` = the solid avatar
// gradient; `cover` adds a top-down vignette for the larger ticket art.
export function swatchGradient(hue: number): string {
  return `linear-gradient(135deg, oklch(0.72 0.13 ${String(hue)}) 0%, oklch(0.46 0.14 ${String((hue + 30) % 360)}) 100%)`;
}

export function coverGradient(hue: number): string {
  const vignette =
    "radial-gradient(125% 115% at 50% 6%, transparent 42%, rgb(17 16 9 / 0.30) 100%)";
  return `${vignette}, linear-gradient(168deg, oklch(0.82 0.075 ${String(hue)}) 0%, oklch(0.60 0.13 ${String((hue + 8) % 360)}) 52%, oklch(0.42 0.135 ${String((hue + 24) % 360)}) 100%)`;
}

// "What's included" fallback — a producer may not have filled deliverables;
// the terms list still needs a body line under "This booking covers:".
export function includesOrFallback(includes: string[], producerName: string): string[] {
  return includes.length > 0
    ? includes
    : [`Everything agreed with ${producerName} for this offer`];
}

// The plain-language agreement summary shown above the binding PDF. The PDF
// is the binding document; this is the readable version (design system §7).
export function buildAgreementTerms(producerName: string, includes: string[]): AgreementTerm[] {
  return [
    {
      heading: "Booking & approval",
      body: `You're sending a request, not a confirmed booking. ${producerName} reviews it within 24 hours and may accept or decline. Your quoted price locks the moment you send — and won't change for this booking, even if ${producerName}'s rates move later.`,
    },
    {
      heading: "What's included",
      body: "This booking covers:",
      points: includesOrFallback(includes, producerName),
    },
    {
      heading: "Payment is handled off-app",
      body: `After approval you'll pay by bank transfer or Bit, using the details ${producerName} shares. Skitza records every payment but never processes, holds, or refunds money on your behalf.`,
    },
    {
      heading: "Deposit & plans",
      body: `A deposit secures your slot and is usually non-refundable once work begins. On a plan, the remaining balance follows the schedule you agree together. Sessions can run on a deposit — but downloads stay locked until the booking is fully paid.`,
    },
    {
      heading: "Rescheduling & cancellation",
      body: `You can reschedule or cancel yourself up to the window set for this offer (shown when you book). Closer than that, message ${producerName} directly. Any refund or credit follows this agreement — not an app rule.`,
    },
    {
      heading: "Delivery & ownership",
      body: `Stream your delivered songs any time. Downloads unlock at full payment. Usage rights, credits and splits are as written in ${producerName}'s full document below.`,
    },
    {
      heading: "Records & notifications",
      body: `Your agreement, this timestamp, and every payment proof are saved to this booking. We notify you by app and email at each step.`,
    },
  ];
}
