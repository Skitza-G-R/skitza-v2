import { unitPriceFor, type VolumeTier } from "~/lib/pricing";

// ─── Purchase price snapshot (SK-37 / BE-1) ─────────────────────────
// Pure helper that computes the price-lock snapshot stored on a
// purchaseRequest at request time. All four pricing models are covered
// (the artist purchase flow is not restricted to flat/per_song the way
// the legacy store self-checkout is):
//
//   * flat / bundle → the product's canonical priceCents.
//   * per_song      → songQty × unitPriceCents (unit validated against
//                     the volume-tier ladder by validatePerSongUnit
//                     below so a tampered payload can't lock a cheaper
//                     rate than the producer offered).
//   * hourly        → the locked hourly RATE (hourlyRateCents). There is
//                     no session yet at request time, so we lock the
//                     rate; the actual amount accrues per booked hour in
//                     the BE-3 session slice. unitPriceCents carries the
//                     rate so downstream math has the per-unit figure.
//
// Returns minor units (cents); tax is NOT applied here — it's a
// producer-level setting applied at payment time (BE-2), matching how
// bookings/projects snapshot pre-tax amounts.

export type PricingModel = "flat" | "per_song" | "hourly" | "bundle";

export interface ProductPriceInput {
  pricingModel: string;
  priceCents: number;
  hourlyRateCents: number | null;
  volumeTiers: VolumeTier[] | null;
}

export interface PriceSnapshot {
  priceCents: number;
  unitPriceCents: number | null;
  listUnitPriceCents: number | null;
  listSubtotalCents: number;
  discountCents: number;
  songQty: number | null;
}

export interface SnapshotOpts {
  songQty?: number | null;
  unitPriceCents?: number | null;
}

// Validates a client-supplied per-song unit price against the product's
// volume-tier ladder. Returns the authoritative unit price (the server
// re-runs the same math the artist stepper used) or null when the
// supplied figures are missing/mismatched, letting the caller throw a
// precise tRPC error.
export function validatePerSongUnit(
  product: Pick<ProductPriceInput, "volumeTiers">,
  songQty: number | null | undefined,
  unitPriceCents: number | null | undefined,
): { ok: true; songQty: number; unitPriceCents: number } | { ok: false } {
  if (songQty == null || unitPriceCents == null) return { ok: false };
  if (!Number.isInteger(songQty) || songQty < 1) return { ok: false };
  const serverUnit = unitPriceFor(songQty, product.volumeTiers ?? []);
  if (serverUnit !== unitPriceCents) return { ok: false };
  return { ok: true, songQty, unitPriceCents };
}

export function snapshotProductPrice(
  product: ProductPriceInput,
  opts: SnapshotOpts = {},
): PriceSnapshot {
  switch (product.pricingModel) {
    case "per_song": {
      // Caller is expected to have validated via validatePerSongUnit
      // first; we defensively fall back to qty=1 at the first tier so a
      // bad call never produces a negative/NaN total.
      const songQty = opts.songQty ?? 1;
      const tiers = product.volumeTiers ?? [];
      const unit = opts.unitPriceCents ?? unitPriceFor(songQty, tiers);
      const listUnitPriceCents = unitPriceFor(1, tiers);
      const priceCents = songQty * unit;
      const listSubtotalCents = songQty * listUnitPriceCents;
      const discountCents = listSubtotalCents - priceCents;
      if (
        !Number.isSafeInteger(priceCents) ||
        !Number.isSafeInteger(listSubtotalCents) ||
        !Number.isSafeInteger(discountCents) ||
        discountCents < 0
      ) {
        throw new Error("Per-song volume discount must be a safe nonnegative cents amount");
      }
      return {
        priceCents,
        unitPriceCents: unit,
        listUnitPriceCents,
        listSubtotalCents,
        discountCents,
        songQty,
      };
    }
    case "hourly": {
      const rate = product.hourlyRateCents ?? 0;
      return {
        priceCents: rate,
        unitPriceCents: rate,
        listUnitPriceCents: rate,
        listSubtotalCents: rate,
        discountCents: 0,
        songQty: null,
      };
    }
    // flat, bundle, and any legacy/unknown model lock the canonical
    // flat price.
    default:
      return {
        priceCents: product.priceCents,
        unitPriceCents: null,
        listUnitPriceCents: null,
        listSubtotalCents: product.priceCents,
        discountCents: 0,
        songQty: null,
      };
  }
}
