(function attachSkitzaPushPolicy(scope) {
  "use strict";

  const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
  const CATEGORIES = new Set([
    "booking",
    "payment",
    "comment",
    "project_status",
    "song_status",
    "purchase_status",
  ]);
  const PATHS = [
    new RegExp(`^/dashboard/payments/${UUID}$`, "i"),
    new RegExp(`^/dashboard/music/${UUID}$`, "i"),
    new RegExp(`^/dashboard/requests/${UUID}$`, "i"),
    new RegExp(`^/dashboard/clients-projects/${UUID}$`, "i"),
    new RegExp(`^/dashboard/clients-projects/${UUID}/songs/${UUID}$`, "i"),
    new RegExp(`^/artist/sessions/${UUID}$`, "i"),
    new RegExp(`^/artist/payments/${UUID}$`, "i"),
    new RegExp(`^/artist/music/${UUID}$`, "i"),
    new RegExp(`^/artist/music/song/${UUID}$`, "i"),
  ];
  const QUERY_PATHS = [
    new RegExp(`^/artist/purchase/${UUID}/pay$`, "i"),
    new RegExp(`^/artist/purchase/${UUID}/sent$`, "i"),
  ];
  const VALIDATION_ORIGIN = "https://push-link.skitza.invalid";

  function validateRelativeRoute(value) {
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

    let parsed;
    try {
      parsed = new URL(value, VALIDATION_ORIGIN);
    } catch {
      return null;
    }
    if (parsed.origin !== VALIDATION_ORIGIN || parsed.username || parsed.password || parsed.hash) {
      return null;
    }

    if (parsed.pathname === "/dashboard/calendar") {
      const keys = Array.from(parsed.searchParams.keys());
      const booking = parsed.searchParams.getAll("booking");
      if (
        keys.some((key) => key !== "booking") ||
        booking.length !== 1 ||
        !new RegExp(`^${UUID}$`, "i").test(booking[0] || "")
      ) {
        return null;
      }
      return `${parsed.pathname}?${parsed.searchParams.toString()}`;
    }

    if (QUERY_PATHS.some((pattern) => pattern.test(parsed.pathname))) {
      const keys = Array.from(parsed.searchParams.keys());
      const request = parsed.searchParams.getAll("req");
      if (
        keys.some((key) => key !== "req") ||
        request.length !== 1 ||
        !new RegExp(`^${UUID}$`, "i").test(request[0] || "")
      ) {
        return null;
      }
      return `${parsed.pathname}?${parsed.searchParams.toString()}`;
    }

    if (parsed.search) return null;
    return PATHS.some((pattern) => pattern.test(parsed.pathname)) ? parsed.pathname : null;
  }

  function parsePayload(value) {
    if (
      !value ||
      typeof value !== "object" ||
      value.version !== 1 ||
      !CATEGORIES.has(value.category) ||
      typeof value.title !== "string" ||
      value.title.length < 1 ||
      value.title.length > 80 ||
      typeof value.body !== "string" ||
      value.body.length < 1 ||
      value.body.length > 160
    ) {
      return null;
    }
    const url = validateRelativeRoute(value.url);
    if (!url) return null;
    return {
      category: value.category,
      title: value.title,
      body: value.body,
      url,
    };
  }

  scope.SkitzaPushPolicy = Object.freeze({
    parsePayload,
    validateRelativeRoute,
  });
})(typeof self === "undefined" ? globalThis : self);
