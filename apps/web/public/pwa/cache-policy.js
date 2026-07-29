(function attachSkitzaCachePolicy(scope) {
  "use strict";

  const SAFE_EXACT_PATHS = new Set([
    "/favicon.ico",
    "/launch",
    "/manifest.webmanifest",
    "/offline.html",
    "/pwa/offline-context.js",
  ]);
  const SAFE_PREFIXES = ["/_next/static/", "/icons/"];
  const SIGNED_QUERY_KEYS = new Set([
    "awsaccesskeyid",
    "expires",
    "googleaccessid",
    "key-pair-id",
    "policy",
    "response-content-disposition",
    "sig",
    "signature",
    "token",
    "uploadid",
    "x-amz-algorithm",
    "x-amz-credential",
    "x-amz-date",
    "x-amz-expires",
    "x-amz-security-token",
    "x-amz-signature",
  ]);
  const SENSITIVE_PATH_PATTERNS = [
    /^\/(?:api|trpc)(?:\/|$)/i,
    /^\/_next\/(?:data|image)(?:\/|$)/i,
    /^\/(?:__clerk|_clerk|clerk)(?:\/|$)/i,
    /^\/(?:artist|artist-welcome|dashboard|onboarding|projects|settings|sign-in|sign-up)(?:\/|$)/i,
    /(?:^|\/)(?:audio|book|booking|bookings|checkout|delivery|deliveries|download|downloads|listen|music|offer|offers|pay|payment|payments|proof|proofs|protected|purchase|purchases|song|songs|track|tracks|upload|uploads)(?:\/|$)/i,
  ];

  function headerValue(request, name) {
    if (!request || !request.headers) return "";
    if (typeof request.headers.get === "function") {
      return request.headers.get(name) || "";
    }

    const expected = name.toLowerCase();
    const entry = Object.entries(request.headers).find(
      ([key]) => key.toLowerCase() === expected,
    );
    return entry ? String(entry[1]) : "";
  }

  function hasSignedQuery(url) {
    for (const key of url.searchParams.keys()) {
      if (SIGNED_QUERY_KEYS.has(key.toLowerCase())) return true;
    }
    return false;
  }

  function isRscRequest(request, url) {
    return (
      url.searchParams.has("_rsc") ||
      headerValue(request, "rsc") === "1" ||
      headerValue(request, "next-router-state-tree").length > 0 ||
      headerValue(request, "accept")
        .toLowerCase()
        .includes("text/x-component")
    );
  }

  function isSensitivePath(pathname) {
    return SENSITIVE_PATH_PATTERNS.some((pattern) => pattern.test(pathname));
  }

  function isExplicitlySafePath(pathname) {
    return (
      SAFE_EXACT_PATHS.has(pathname) ||
      SAFE_PREFIXES.some((prefix) => pathname.startsWith(prefix))
    );
  }

  function classifyRequest(request, ownOrigin) {
    if (!request || request.method !== "GET") {
      return { action: "network-only", reason: "non-get" };
    }

    const url = new URL(request.url, ownOrigin);
    if (url.origin !== ownOrigin) {
      return { action: "network-only", reason: "cross-origin" };
    }
    if (headerValue(request, "authorization").length > 0) {
      return { action: "network-only", reason: "authorization" };
    }
    if (headerValue(request, "range").length > 0) {
      return { action: "network-only", reason: "range" };
    }
    if (
      request.destination === "audio" ||
      request.destination === "video" ||
      /^(?:audio|video)\//i.test(headerValue(request, "accept"))
    ) {
      return { action: "network-only", reason: "media" };
    }
    if (hasSignedQuery(url)) {
      return { action: "network-only", reason: "signed-url" };
    }
    if (isRscRequest(request, url)) {
      return { action: "network-only", reason: "rsc" };
    }
    if (isSensitivePath(url.pathname)) {
      return { action: "network-only", reason: "sensitive-path" };
    }
    if (url.pathname === "/launch" && url.search.length > 0) {
      return { action: "network-only", reason: "not-allowlisted" };
    }
    if (isExplicitlySafePath(url.pathname)) {
      return { action: "cache", reason: "explicit-safe-resource" };
    }

    return { action: "network-only", reason: "not-allowlisted" };
  }

  scope.SkitzaCachePolicy = Object.freeze({
    classifyRequest,
    isExplicitlySafePath,
    isSensitivePath,
    safeExactPaths: Object.freeze(Array.from(SAFE_EXACT_PATHS)),
    safePrefixes: Object.freeze(Array.from(SAFE_PREFIXES)),
  });
})(typeof self === "undefined" ? globalThis : self);
