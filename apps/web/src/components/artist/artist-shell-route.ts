export type ArtistShellMode = "standing" | "focused";

const PURCHASE_STEP_PATH =
  /^\/artist\/purchase\/[^/]+\/(?:request|agree|sent|pay(?:\/(?:instructions|proof))?)$/;
const SESSION_ACTION_PATH = /^\/artist\/sessions\/[^/]+\/(?:cancel|reschedule)$/;
const PAYMENT_PROCESS_PATH =
  /^\/artist\/payments\/[^/]+\/(?:instructions|proof\/[^/]+)$/;

function normalizeArtistPath(pathname: string | null): string {
  if (!pathname || pathname === "/") return pathname ?? "";
  return pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
}

export function getArtistShellMode(pathname: string | null): ArtistShellMode {
  const normalizedPath = normalizeArtistPath(pathname);
  if (
    normalizedPath === "/artist/book" ||
    normalizedPath === "/artist/settings/account/delete" ||
    PURCHASE_STEP_PATH.test(normalizedPath) ||
    PAYMENT_PROCESS_PATH.test(normalizedPath) ||
    SESSION_ACTION_PATH.test(normalizedPath)
  ) {
    return "focused";
  }
  return "standing";
}

export function isArtistFocusedPath(pathname: string | null): boolean {
  return getArtistShellMode(pathname) === "focused";
}
