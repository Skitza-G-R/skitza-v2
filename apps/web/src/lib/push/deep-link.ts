const UUID_SEGMENT = "[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";

const EXACT_PATHS = [
  new RegExp(`^/dashboard/payments/${UUID_SEGMENT}$`, "i"),
  new RegExp(`^/dashboard/music/${UUID_SEGMENT}$`, "i"),
  new RegExp(`^/dashboard/requests/${UUID_SEGMENT}$`, "i"),
  new RegExp(`^/dashboard/clients-projects/${UUID_SEGMENT}$`, "i"),
  new RegExp(`^/dashboard/clients-projects/${UUID_SEGMENT}/songs/${UUID_SEGMENT}$`, "i"),
  new RegExp(`^/artist/sessions/${UUID_SEGMENT}$`, "i"),
  new RegExp(`^/artist/payments/${UUID_SEGMENT}$`, "i"),
  new RegExp(`^/artist/music/${UUID_SEGMENT}$`, "i"),
  new RegExp(`^/artist/music/song/${UUID_SEGMENT}$`, "i"),
] as const;

const EXACT_QUERY_PATHS = [
  new RegExp(`^/artist/purchase/${UUID_SEGMENT}/pay$`, "i"),
  new RegExp(`^/artist/purchase/${UUID_SEGMENT}/sent$`, "i"),
] as const;

const VALIDATION_ORIGIN = "https://push-link.skitza.invalid";

/**
 * Push payloads may navigate only to authenticated, exact-item app routes.
 * Returning a relative URL keeps deployment hosts out of stored payloads and
 * makes an external origin, protocol-relative URL, auth route, or public token
 * fail closed in both the server sender and service worker.
 */
export function validatePushDeepLink(value: unknown): string | null {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 512 ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.includes("\\")
  ) {
    return null;
  }

  let parsed: URL;
  try {
    parsed = new URL(value, VALIDATION_ORIGIN);
  } catch {
    return null;
  }
  if (parsed.origin !== VALIDATION_ORIGIN || parsed.username || parsed.password || parsed.hash) {
    return null;
  }

  if (parsed.pathname === "/dashboard/calendar") {
    if (
      [...parsed.searchParams.keys()].some((key) => key !== "booking") ||
      parsed.searchParams.getAll("booking").length !== 1 ||
      !new RegExp(`^${UUID_SEGMENT}$`, "i").test(parsed.searchParams.get("booking") ?? "")
    ) {
      return null;
    }
    return `${parsed.pathname}?${parsed.searchParams.toString()}`;
  }

  if (EXACT_QUERY_PATHS.some((pattern) => pattern.test(parsed.pathname))) {
    if (
      [...parsed.searchParams.keys()].some((key) => key !== "req") ||
      parsed.searchParams.getAll("req").length !== 1 ||
      !new RegExp(`^${UUID_SEGMENT}$`, "i").test(parsed.searchParams.get("req") ?? "")
    ) {
      return null;
    }
    return `${parsed.pathname}?${parsed.searchParams.toString()}`;
  }

  if (parsed.search !== "") return null;
  return EXACT_PATHS.some((pattern) => pattern.test(parsed.pathname)) ? parsed.pathname : null;
}
