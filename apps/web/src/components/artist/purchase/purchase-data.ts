// Types + placeholder data for the artist purchase flow (Commit section).
//
// The shapes here deliberately mirror Raz's BE-1 contract (SK-37):
//   - `PurchaseProduct`  → the price-locked product snapshot
//   - `Producer`         → producer + the uploaded Booking_Agreement.pdf
//   - `RequestResult`    → what `artist.purchase.request` returns (ref #)
//
// While BE-1 is in flight the screens render against MOCK_* below. When the
// procedures land, the route `page.tsx` swaps the mock for the tRPC caller
// and passes the same shapes down — no screen changes required.

export type PurchaseProduct = {
  id: string;
  /** Producer SKU, e.g. "GS-01" — used in the request ref. */
  sku: string;
  name: string;
  /** Price-locked snapshot, in agorot (₪1 = 100). */
  priceCents: number;
  currency: string;
  /** Human duration label, e.g. "Multi-session · 3–4 weeks". */
  durationLabel: string;
  /** What the booking covers — the agreement's "What's included" list. */
  includes: string[];
};

export type Producer = {
  name: string;
  initials: string;
  /** Cover-gradient hue so the booking thumbnail matches the store. */
  hue: number;
  agreement: { filename: string; sizeLabel: string };
};

export type RequestResult = {
  /** Booking reference, e.g. "SKZ-2417-01". */
  ref: string;
  status: "pending" | "approved" | "declined";
  /** Price captured at request time — won't change for this booking. */
  priceLockedCents: number;
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

// Deterministic booking ref so the mock confirmation is stable across renders
// (no Date/random). BE-1 will issue the real ref server-side.
export function makeRequestRef(product: Pick<PurchaseProduct, "id" | "sku">): string {
  const base = 2400 + (product.id.charCodeAt(1) || 1) * 7;
  return `SKZ-${String(base)}-${product.sku.slice(-2)}`;
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
      points: includes,
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

// ── Placeholder content (mirrors the prototype's flagship "g1" offer) ──
// Replaced by the real product snapshot + producer from BE-1.
export const MOCK_PRODUCER: Producer = {
  name: "Gili Studio",
  initials: "GS",
  hue: 30,
  agreement: { filename: "Booking_Agreement.pdf", sizeLabel: "248 KB" },
};

export const MOCK_PRODUCT: PurchaseProduct = {
  id: "g1",
  sku: "GS-01",
  name: "Single — start to finish",
  priceCents: 240000,
  currency: "ILS",
  durationLabel: "Multi-session · 3–4 weeks",
  includes: [
    "Up to 4 song parts tracked",
    "Comped & tuned lead vocal",
    "Full mix + master",
    "2 revision rounds",
    "WAV stems + masters delivered",
  ],
};
