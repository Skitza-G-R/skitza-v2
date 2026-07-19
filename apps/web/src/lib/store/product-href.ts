// Every signed-in Store card enters the same purchase funnel. Quantity for a
// per-song product is chosen on that unified detail screen, so no pricing
// model has a separate checkout route anymore.
export function productHref(product: {
  id: string;
  pricingModel: "flat" | "per_song" | "hourly" | "bundle";
}): string {
  return `/artist/purchase/${product.id}`;
}
