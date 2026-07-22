/**
 * Resource IDs belong to one producer. Carrying a product, payment, song,
 * project, proposal, offer, or session ID into another studio can show a 404
 * or an access error. These mappings move a studio switch to the equivalent
 * safe list/tab root and deliberately drop resource-specific query values.
 *
 * Exact list/tab roots are already safe, so they keep their current path and
 * non-studio query state while only replacing the selected studio.
 */
const RESOURCE_ROOTS: ReadonlyArray<readonly [prefix: string, safeRoot: string]> = [
  ["/artist/purchase/", "/artist/store"],
  ["/artist/store/", "/artist/store"],
  ["/artist/offers/", "/artist/store"],
  ["/artist/payments/", "/artist/payments"],
  ["/artist/music/", "/artist/music"],
  ["/artist/sessions/", "/artist/sessions"],
];

export function artistStudioSwitchHref(
  pathname: string,
  currentQuery: string,
  producerId: string,
): string {
  const safeRoot = RESOURCE_ROOTS.find(([prefix]) => pathname.startsWith(prefix))?.[1];
  const params = safeRoot ? new URLSearchParams() : new URLSearchParams(currentQuery);
  if (pathname === "/artist/book") {
    for (const resourceKey of ["session", "allowance", "project", "producerId"]) {
      params.delete(resourceKey);
    }
  }
  params.set("studio", producerId);
  return `${safeRoot ?? pathname}?${params.toString()}`;
}
