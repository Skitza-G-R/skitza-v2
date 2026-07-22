const URL_PATTERN = /https?:\/\/[^\s"'<>]+/giu;
const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu;
const UUID_PATTERN =
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/giu;
const JWT_PATTERN = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/gu;
const SECRET_PREFIX_PATTERN =
  /\b(?:sk|pk|rk|whsec|clerk|sess|token|secret|key)_(?:test|live|prod|dev)?_?[A-Za-z0-9_-]{8,}\b/giu;
const LONG_OPAQUE_PATTERN = /\b[A-Za-z0-9_-]{40,}\b/gu;

export function redactDiagnostic(value: string): string {
  return value
    .replace(URL_PATTERN, "[url]")
    .replace(EMAIL_PATTERN, "[email]")
    .replace(UUID_PATTERN, "[id]")
    .replace(JWT_PATTERN, "[secret]")
    .replace(SECRET_PREFIX_PATTERN, "[secret]")
    .replace(LONG_OPAQUE_PATTERN, "[opaque]")
    .slice(0, 400);
}

export function safeRequestLabel(rawUrl: string, baseURL: string): string {
  try {
    const url = new URL(rawUrl);
    const base = new URL(baseURL);
    return url.origin === base.origin
      ? `[same-site] ${redactDiagnostic(url.pathname)}`
      : "[cross-site request]";
  } catch {
    return "[invalid request URL]";
  }
}

export function safeNetworkFailureCode(errorText: string | undefined): string {
  const code = errorText?.match(/(?:net::)?ERR_[A-Z0-9_]+/u)?.[0];
  return code ?? "request failed";
}
