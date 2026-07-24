(function attachSkitzaOfflineContext(scope) {
  "use strict";

  const RUNTIME_PREFIX = "skitza:runtime:user=";
  const SCHEMA_VERSION = 1;
  const MAX_VIEW_AGE_MS = 7 * 24 * 60 * 60 * 1000;
  const NAVIGATION_SLOT = "runtime.navigation.snapshot";
  const PRODUCER_OVERVIEW_SLOT = "producer.overview.safe-view";
  const ARTIST_HOME_SLOT = "artist.home.safe-view";
  const VALIDATION_ORIGIN = "https://offline-context.skitza.invalid";
  const BLOCKED_ROUTE_PREFIXES = [
    "/api",
    "/sign-in",
    "/sign-up",
    "/dashboard/calendar",
    "/dashboard/payments",
    "/artist/book",
    "/artist/payments",
    "/artist/purchase",
    "/artist/sessions",
  ];
  const SAFE_ID_SEGMENT = "[A-Za-z0-9_-]{1,128}";
  const PRODUCER_ROUTE_PATTERNS = [
    /^\/dashboard$/,
    /^\/dashboard\/calendar$/,
    /^\/dashboard\/clients-projects$/,
    /^\/dashboard\/clients-projects\/new$/,
    new RegExp(`^/dashboard/clients-projects/(?!new$|clients$)${SAFE_ID_SEGMENT}$`),
    new RegExp(`^/dashboard/clients-projects/${SAFE_ID_SEGMENT}/songs/${SAFE_ID_SEGMENT}$`),
    new RegExp(`^/dashboard/clients-projects/clients/${SAFE_ID_SEGMENT}$`),
    /^\/dashboard\/music$/,
    new RegExp(`^/dashboard/music/(?!project$)${SAFE_ID_SEGMENT}$`),
    new RegExp(`^/dashboard/music/project/${SAFE_ID_SEGMENT}$`),
    /^\/dashboard\/onboarding$/,
    /^\/dashboard\/payments$/,
    new RegExp(`^/dashboard/payments/${SAFE_ID_SEGMENT}$`),
    /^\/dashboard\/portfolio$/,
    /^\/dashboard\/profile$/,
    /^\/dashboard\/requests$/,
    new RegExp(`^/dashboard/requests/${SAFE_ID_SEGMENT}$`),
    /^\/dashboard\/settings$/,
    /^\/dashboard\/store$/,
  ];
  const ARTIST_ROUTE_PATTERNS = [
    /^\/artist$/,
    /^\/artist\/music$/,
    new RegExp(`^/artist/music/(?!song$|no-charge$)${SAFE_ID_SEGMENT}$`),
    new RegExp(`^/artist/music/song/${SAFE_ID_SEGMENT}$`),
    /^\/artist\/store$/,
    /^\/artist\/settings$/,
  ];

  function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }

  function hasExactKeys(value, expected) {
    const actual = Object.keys(value).sort();
    const wanted = expected.slice().sort();
    return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
  }

  function boundedString(value, maxLength, allowEmpty) {
    return (
      typeof value === "string" &&
      value.length <= maxLength &&
      (allowEmpty === true || value.trim().length > 0)
    );
  }

  function safeInteger(value, min, max) {
    return (
      Number.isSafeInteger(value) &&
      value >= (min === undefined ? 0 : min) &&
      value <= (max === undefined ? Number.MAX_SAFE_INTEGER : max)
    );
  }

  function blockedPath(pathname) {
    return BLOCKED_ROUTE_PREFIXES.some(
      (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
    );
  }

  function allowlistedPath(pathname, role) {
    const patterns = role === "producer" ? PRODUCER_ROUTE_PATTERNS : ARTIST_ROUTE_PATTERNS;
    return patterns.some((pattern) => pattern.test(pathname));
  }

  function enumerated(value, allowed) {
    return allowed.includes(value);
  }

  function allowedQuery(pathname, role, key, value) {
    if (key.length > 40 || value.length > 120) return false;

    if (role === "artist") {
      if (key === "studio") return value.trim().length > 0;
      if (pathname !== "/artist/music") return false;
      if (key === "mode") return enumerated(value, ["projects", "songs"]);
      if (key === "view") return enumerated(value, ["grid", "table"]);
      if (key === "search") return true;
      if (key === "sort") return enumerated(value, ["recent", "title", "notes", "length"]);
      if (key === "filter") return enumerated(value, ["active", "archived"]);
      return false;
    }

    if (pathname === "/dashboard") {
      return key === "view" && value === "all";
    }
    if (pathname === "/dashboard/calendar") {
      return key === "tab" && enumerated(value, ["schedule", "sessions", "availability"]);
    }
    if (pathname === "/dashboard/clients-projects") {
      if (key === "tab") return enumerated(value, ["clients", "projects"]);
      if (key === "filter") return enumerated(value, ["all", "urgent", "active", "archived"]);
      if (key === "sort") {
        return enumerated(value, [
          "custom",
          "recent",
          "deadline",
          "balance",
          "progress",
          "joined",
          "name",
        ]);
      }
      if (key === "view") return enumerated(value, ["cards", "table"]);
      return key === "search";
    }
    if (pathname === "/dashboard/music") {
      if (key === "mode") return enumerated(value, ["projects", "songs"]);
      if (key === "view") return enumerated(value, ["grid", "table"]);
      if (key === "search") return true;
      if (key === "sort") return enumerated(value, ["recent", "title", "notes", "length"]);
      return key === "filter" && enumerated(value, ["active", "archived"]);
    }
    if (pathname === "/dashboard/settings") {
      return key === "section" && enumerated(value, ["profile", "plan", "notif", "int", "region"]);
    }
    return false;
  }

  function normalizeRoute(value) {
    if (
      typeof value !== "string" ||
      !value.startsWith("/") ||
      value.startsWith("//") ||
      value.length > 1024
    ) {
      return null;
    }

    let url;
    try {
      url = new URL(value, VALIDATION_ORIGIN);
    } catch {
      return null;
    }
    if (url.username || url.password || url.hash) return null;

    let role;
    if (url.pathname === "/dashboard" || url.pathname.startsWith("/dashboard/")) {
      role = "producer";
    } else if (url.pathname === "/artist" || url.pathname.startsWith("/artist/")) {
      role = "artist";
    } else {
      return null;
    }
    if (blockedPath(url.pathname) || !allowlistedPath(url.pathname, role)) return null;

    const search = new URLSearchParams();
    for (const [key, entry] of url.searchParams) {
      if (allowedQuery(url.pathname, role, key, entry) && search.size < 30) {
        search.append(key, entry);
      }
    }
    search.sort();

    const query = search.toString();
    return {
      href: `${url.pathname}${query ? `?${query}` : ""}`,
      pathname: url.pathname,
      role,
    };
  }

  function storageKey(runtimeScope, slot) {
    return [
      `skitza:runtime:user=${encodeURIComponent(runtimeScope.userId)}`,
      `schema=${String(SCHEMA_VERSION)}`,
      `role=${runtimeScope.role}`,
      `context=${encodeURIComponent(runtimeScope.contextId)}`,
      `route=${encodeURIComponent(runtimeScope.route)}`,
      `slot=${encodeURIComponent(slot)}`,
    ].join(":");
  }

  function onlyStoredUserId(storage) {
    const userIds = new Set();
    try {
      for (let index = 0; index < storage.length; index += 1) {
        const key = storage.key(index);
        if (!key || !key.startsWith(RUNTIME_PREFIX)) continue;
        const encodedUserId = key.slice(RUNTIME_PREFIX.length).split(":", 1)[0];
        if (!encodedUserId) return null;
        let userId;
        try {
          userId = decodeURIComponent(encodedUserId);
        } catch {
          return null;
        }
        if (!boundedString(userId, 512, false)) return null;
        userIds.add(userId);
        if (userIds.size > 1) return null;
      }
    } catch {
      return null;
    }
    return userIds.size === 1 ? Array.from(userIds)[0] : null;
  }

  function validTimestamp(value, now, maxAge) {
    return safeInteger(value, 0) && value <= now + 60_000 && now - value <= maxAge;
  }

  function validScope(value, userId, route) {
    return (
      isRecord(value) &&
      hasExactKeys(value, ["userId", "role", "contextId", "route"]) &&
      value.userId === userId &&
      value.role === route.role &&
      boundedString(value.contextId, 512, false) &&
      value.route === route.href
    );
  }

  function expectedFilters(href) {
    const url = new URL(href, VALIDATION_ORIGIN);
    return Array.from(url.searchParams, ([key, value]) => ({ key, value }));
  }

  function validNavigationPayload(value, route) {
    if (
      !isRecord(value) ||
      !hasExactKeys(value, ["href", "scrollTop", "filters"]) ||
      value.href !== route.href ||
      !safeInteger(value.scrollTop, 0, 100_000_000) ||
      !Array.isArray(value.filters) ||
      value.filters.length > 30
    ) {
      return false;
    }
    const filters = expectedFilters(route.href);
    return (
      filters.length === value.filters.length &&
      value.filters.every(
        (entry, index) =>
          isRecord(entry) &&
          hasExactKeys(entry, ["key", "value"]) &&
          entry.key === filters[index].key &&
          entry.value === filters[index].value,
      )
    );
  }

  function parseNavigationEnvelope(raw, key, userId, route, now) {
    let envelope;
    try {
      envelope = JSON.parse(raw);
    } catch {
      return null;
    }
    if (
      !isRecord(envelope) ||
      !hasExactKeys(envelope, ["schemaVersion", "scope", "slot", "updatedAt", "payload"]) ||
      envelope.schemaVersion !== SCHEMA_VERSION ||
      envelope.slot !== NAVIGATION_SLOT ||
      !validTimestamp(envelope.updatedAt, now, MAX_VIEW_AGE_MS) ||
      !validScope(envelope.scope, userId, route) ||
      !validNavigationPayload(envelope.payload, route) ||
      key !== storageKey(envelope.scope, NAVIGATION_SLOT)
    ) {
      return null;
    }
    return envelope;
  }

  function latestNavigationEnvelope(storage, userId, route, now) {
    let latest = null;
    try {
      for (let index = 0; index < storage.length; index += 1) {
        const key = storage.key(index);
        if (!key || !key.endsWith(`:slot=${encodeURIComponent(NAVIGATION_SLOT)}`)) continue;
        const raw = storage.getItem(key);
        if (!raw) continue;
        const envelope = parseNavigationEnvelope(raw, key, userId, route, now);
        if (envelope && (!latest || envelope.updatedAt > latest.updatedAt)) {
          latest = envelope;
        }
      }
    } catch {
      return null;
    }
    return latest;
  }

  function baseEnvelopeIsValid(envelope, scopeValue, slot, now) {
    return (
      isRecord(envelope) &&
      hasExactKeys(envelope, ["schemaVersion", "scope", "slot", "updatedAt", "payload"]) &&
      envelope.schemaVersion === SCHEMA_VERSION &&
      envelope.slot === slot &&
      validTimestamp(envelope.updatedAt, now, MAX_VIEW_AGE_MS) &&
      isRecord(envelope.scope) &&
      hasExactKeys(envelope.scope, ["userId", "role", "contextId", "route"]) &&
      envelope.scope.userId === scopeValue.userId &&
      envelope.scope.role === scopeValue.role &&
      envelope.scope.contextId === scopeValue.contextId &&
      envelope.scope.route === scopeValue.route
    );
  }

  function readEnvelope(storage, scopeValue, slot, now) {
    const key = storageKey(scopeValue, slot);
    try {
      const raw = storage.getItem(key);
      if (!raw) return null;
      const envelope = JSON.parse(raw);
      return baseEnvelopeIsValid(envelope, scopeValue, slot, now) ? envelope : null;
    } catch {
      return null;
    }
  }

  function producerSummary(storage, navigation, now) {
    if (navigation.scope.route !== "/dashboard") return null;
    const envelope = readEnvelope(storage, navigation.scope, PRODUCER_OVERVIEW_SLOT, now);
    const payload = envelope && envelope.payload;
    if (
      !isRecord(payload) ||
      !hasExactKeys(payload, ["displayName", "activeProjects"]) ||
      !(payload.displayName === null || boundedString(payload.displayName, 80, true)) ||
      !safeInteger(payload.activeProjects, 0, 1_000_000)
    ) {
      return null;
    }
    const owner =
      payload.displayName && payload.displayName.trim() ? ` for ${payload.displayName.trim()}` : "";
    const projects = payload.activeProjects === 1 ? "project" : "projects";
    return {
      summary: `Saved overview${owner}: ${String(payload.activeProjects)} active ${projects}.`,
      updatedAt: Math.max(navigation.updatedAt, envelope.updatedAt),
    };
  }

  function artistSummary(storage, navigation, now) {
    if (navigation.scope.route !== "/artist") return null;
    const envelope = readEnvelope(storage, navigation.scope, ARTIST_HOME_SLOT, now);
    const payload = envelope && envelope.payload;
    if (
      !isRecord(payload) ||
      !hasExactKeys(payload, ["firstName", "studios"]) ||
      !boundedString(payload.firstName, 80, false) ||
      !Array.isArray(payload.studios) ||
      payload.studios.length > 100 ||
      !payload.studios.every(
        (studio) =>
          isRecord(studio) &&
          hasExactKeys(studio, ["producerId", "producerName", "producerSlug"]) &&
          boundedString(studio.producerId, 128, false) &&
          boundedString(studio.producerName, 120, false) &&
          boundedString(studio.producerSlug, 80, false),
      )
    ) {
      return null;
    }
    const studios = payload.studios.length === 1 ? "studio" : "studios";
    return {
      summary: `Saved home for ${payload.firstName}: ${String(payload.studios.length)} connected ${studios}.`,
      updatedAt: Math.max(navigation.updatedAt, envelope.updatedAt),
    };
  }

  function routeLabel(route) {
    const pathname = route.pathname;
    const families =
      route.role === "producer"
        ? [
            ["/dashboard/clients-projects", "Clients and projects"],
            ["/dashboard/music", "Music"],
            ["/dashboard/store", "Store"],
            ["/dashboard/portfolio", "Portfolio"],
            ["/dashboard/requests", "Requests"],
            ["/dashboard/settings", "Settings"],
          ]
        : [
            ["/artist/music", "Music"],
            ["/artist/store", "Store"],
            ["/artist/settings", "Settings"],
          ];
    const match = families.find(
      ([prefix]) => pathname === prefix || pathname.startsWith(`${prefix}/`),
    );
    if (match) return match[1];
    return pathname === (route.role === "producer" ? "/dashboard" : "/artist")
      ? "Home"
      : route.role === "producer"
        ? "Producer"
        : "Artist";
  }

  function readSavedContext(storage, locationHref, now) {
    const route = normalizeRoute(locationHref);
    if (!route || !storage || !safeInteger(now, 0)) return null;
    const userId = onlyStoredUserId(storage);
    if (!userId) return null;
    const navigation = latestNavigationEnvelope(storage, userId, route, now);
    if (!navigation) return null;

    const detail =
      route.role === "producer"
        ? producerSummary(storage, navigation, now)
        : artistSummary(storage, navigation, now);
    const label = routeLabel(route);
    return {
      role: route.role,
      route: route.href,
      label,
      title: `Saved ${label.toLowerCase()} context.`,
      summary:
        detail && detail.summary
          ? detail.summary
          : `This ${label.toLowerCase()} screen was viewed recently for this account.`,
      updatedAt: detail ? detail.updatedAt : navigation.updatedAt,
    };
  }

  scope.SkitzaOfflineContext = Object.freeze({
    readSavedContext,
  });
})(typeof self === "undefined" ? globalThis : self);
