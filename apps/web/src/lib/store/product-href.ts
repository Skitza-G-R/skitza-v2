// Where a store card sends the artist.
//
// Flat / bundle / hourly products enter the Request-to-book funnel (S3 —
// price locks at request, Gate 1, money off-app). Per-song products still
// use the legacy store detail page: it owns the song-count stepper, and the
// funnel has no qty picker yet (follow-up on SK-46).
export function productHref(product: {
  id: string;
  pricingModel: "flat" | "per_song" | "hourly" | "bundle";
}): string {
  return product.pricingModel === "per_song"
    ? `/artist/store/${product.id}`
    : `/artist/purchase/${product.id}`;
}
