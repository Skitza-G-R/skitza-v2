const REDACTED_AUTHORITY = "[redacted]";
const LISTEN_TOKEN_PATTERN = /(\/listen\/)([^/?#\s"'<>]+)/gi;
const QUERY_AUTHORITY_PATTERN = /(^|[?&\s])((?:token|cap)=)([^&#\s"'<>]*)/gi;
const AUTHORITY_PROPERTY_NAMES = new Set(["token", "cap"]);

export function isPublicSongListenPath(pathname: string): boolean {
  return pathname === "/listen" || pathname.startsWith("/listen/");
}

export function redactPublicSongTelemetryString(value: string): string {
  return value
    .replace(LISTEN_TOKEN_PATTERN, (_match, prefix: string) => `${prefix}${REDACTED_AUTHORITY}`)
    .replace(
      QUERY_AUTHORITY_PATTERN,
      (_match, separator: string, name: string) => `${separator}${name}${REDACTED_AUTHORITY}`,
    );
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
  if (prototype !== Object.prototype && prototype !== null) return value;

  const redacted: Record<string, unknown> = {};
  seen.set(value, redacted);
  for (const [key, child] of Object.entries(value)) {
    redacted[key] = AUTHORITY_PROPERTY_NAMES.has(key.toLowerCase())
      ? REDACTED_AUTHORITY
      : redactValue(child, seen);
  }
  return redacted;
}

/** Scrubs bearer URLs and public-audio query authorities from an analytics payload. */
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

export function filterCurrentBrowserPublicSongTelemetry<T>(payload: T): T | null {
  return filterPublicSongBrowserTelemetry(
    payload,
    typeof window === "undefined" ? null : window.location.pathname,
  );
}
