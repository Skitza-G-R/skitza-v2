/** Returns true for every focused artist purchase-funnel route. */
export function isArtistPurchasePath(pathname: string | null): boolean {
  return pathname === "/artist/purchase" || Boolean(pathname?.startsWith("/artist/purchase/"));
}
