const REDACTED_AUTHORITY = "[redacted]";
const LISTEN_TOKEN_PATTERN = /(\/listen\/)([^/?#\s"'<>]+)/gi;
const QUERY_PARAMETER_PATTERN = /(^|[?&\s])([^=?&#\s"'<>]+)=([^&#\s"'<>]*)/g;
const SONG_VERSION_UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const NORMAL_SONG_ADDRESS_PATTERN = new RegExp(
  `(\\/(?:dashboard\\/music|artist\\/music\\/song)\\/)(${SONG_VERSION_UUID})(?=$|[?#\\s"'<>])`,
  "gi",
);
const NORMAL_SONG_PATH = new RegExp(
  `^/(?:dashboard/music|artist/music/song)/${SONG_VERSION_UUID}$`,
  "i",
);
const AUTHORITY_PROPERTY_NAMES = new Set(["token", "cap", "address", "__clerk_ticket"]);

export function isPublicSongListenPath(pathname: string): boolean {
  return (
    pathname === "/listen" || pathname.startsWith("/listen/") || NORMAL_SONG_PATH.test(pathname)
  );
}

export function hasInvitationTicketAuthority(search: string): boolean {
  const queryStart = search.indexOf("?");
  const rawQuery = queryStart >= 0 ? search.slice(queryStart + 1) : search.replace(/^\?/, "");
  const query = rawQuery.split("#", 1)[0] ?? "";
  return [...new URLSearchParams(query).keys()].some(
    (name) => name.toLowerCase() === "__clerk_ticket",
  );
}

export function isSensitiveAuthorityLocation(pathname: string, search: string): boolean {
  return isPublicSongListenPath(pathname) || hasInvitationTicketAuthority(search);
}

export function redactPublicSongTelemetryString(value: string): string {
  return value
    .replace(LISTEN_TOKEN_PATTERN, (_match, prefix: string) => `${prefix}${REDACTED_AUTHORITY}`)
    .replace(
      NORMAL_SONG_ADDRESS_PATTERN,
      (_match, prefix: string) => `${prefix}${REDACTED_AUTHORITY}`,
    )
    .replace(QUERY_PARAMETER_PATTERN, (match, separator: string, encodedName: string) => {
      let decodedName: string;
      try {
        decodedName = decodeURIComponent(encodedName.replace(/\+/g, " ")).toLowerCase();
      } catch {
        return match;
      }
      return AUTHORITY_PROPERTY_NAMES.has(decodedName)
        ? `${separator}${encodedName}=${REDACTED_AUTHORITY}`
        : match;
    });
}

function objectTag(value: object): string {
  return Object.prototype.toString.call(value);
}

function redactNonPlainValue(value: object, seen: WeakMap<object, unknown>): unknown {
  const tag = objectTag(value);

  if (tag === "[object URL]") {
    return redactPublicSongTelemetryString((value as URL).href);
  }
  if (tag === "[object URLSearchParams]") {
    return redactPublicSongTelemetryString((value as URLSearchParams).toString());
  }

  if (tag === "[object Error]" || value instanceof Error) {
    const source = value as Error & { cause?: unknown; errors?: unknown };
    const redacted: Record<string, unknown> = {
      name: redactPublicSongTelemetryString(source.name),
      message: redactPublicSongTelemetryString(source.message),
    };
    seen.set(value, redacted);
    if (source.stack) redacted.stack = redactPublicSongTelemetryString(source.stack);
    if ("cause" in source) redacted.cause = redactValue(source.cause, seen);
    if ("errors" in source) redacted.errors = redactValue(source.errors, seen);
    for (const [key, child] of Object.entries(source)) {
      redacted[key] = AUTHORITY_PROPERTY_NAMES.has(key.toLowerCase())
        ? REDACTED_AUTHORITY
        : redactValue(child, seen);
    }
    return redacted;
  }

  return value;
}

function redactValue(value: unknown, seen: WeakMap<object, unknown>): unknown {
  if (typeof value === "string") return redactPublicSongTelemetryString(value);
  if (value === null || typeof value !== "object") return value;

  const existing = seen.get(value);
  if (existing !== undefined) return existing;

  if (Array.isArray(value)) {
    const redacted: unknown[] = [];
    seen.set(value, redacted);
    for (const item of value) redacted.push(redactValue(item, seen));
    return redacted;
  }

  const prototype = Reflect.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    return redactNonPlainValue(value, seen);
  }

  const redacted: Record<string, unknown> = {};
  seen.set(value, redacted);
  for (const [key, child] of Object.entries(value)) {
    redacted[key] = AUTHORITY_PROPERTY_NAMES.has(key.toLowerCase())
      ? REDACTED_AUTHORITY
      : redactValue(child, seen);
  }
  return redacted;
}

/** Scrubs bearer URLs, public-audio authorities, and Clerk invitation tickets. */
export function redactPublicSongTelemetry<T>(payload: T): T {
  return redactValue(payload, new WeakMap()) as T;
}

/** Public listen pages do not send browser telemetry; other pages still get authority scrubbing. */
export function filterPublicSongBrowserTelemetry<T>(payload: T, pathname: string | null): T | null {
  if (pathname && isPublicSongListenPath(pathname)) return null;
  return redactPublicSongTelemetry(payload);
}

export function isBrowserPublicSongListenPage(): boolean {
  return typeof window !== "undefined" && isPublicSongListenPath(window.location.pathname);
}

export function isBrowserSensitiveAuthorityPage(): boolean {
  return (
    typeof window !== "undefined" &&
    isSensitiveAuthorityLocation(window.location.pathname, window.location.search)
  );
}

export function filterCurrentBrowserPublicSongTelemetry<T>(payload: T): T | null {
  if (isBrowserSensitiveAuthorityPage()) return null;
  return redactPublicSongTelemetry(payload);
}
