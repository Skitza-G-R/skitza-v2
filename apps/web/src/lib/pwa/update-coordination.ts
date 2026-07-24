export const NATIVE_REFRESH_EVENT = "skitza:native-refresh";
export const NATIVE_UPDATE_BLOCK_EVENT = "skitza:native-update-block";
export const UPDATE_WAITING_STORAGE_KEY = "skitza:native-update-waiting";

export const SW_MESSAGE = {
  activateOnSafeReopen: "SKITZA_ACTIVATE_ON_SAFE_REOPEN",
  activationResult: "SKITZA_ACTIVATION_RESULT",
  clientSafetyQuery: "SKITZA_CLIENT_SAFETY_QUERY",
  getVersion: "SKITZA_GET_VERSION",
  version: "SKITZA_VERSION",
} as const;

const PROTECTED_ACTION_SEGMENTS = new Set([
  "audio",
  "book",
  "booking",
  "bookings",
  "calendar",
  "checkout",
  "delivery",
  "deliveries",
  "download",
  "downloads",
  "listen",
  "music",
  "offer",
  "offers",
  "pay",
  "payment",
  "payments",
  "proof",
  "proofs",
  "purchase",
  "purchases",
  "song",
  "songs",
  "track",
  "tracks",
  "upload",
  "uploads",
]);

const ALWAYS_PROTECTED_PREFIXES = [
  "/artist-welcome",
  "/get-started",
  "/onboarding",
  "/sign-in",
  "/sign-up",
] as const;

export type SafeReopenDecision = Readonly<{
  waitingWorkerFound: boolean;
  waitingVersionWasObservedBeforeBoot: boolean;
  pathname: string;
  visibilityState: DocumentVisibilityState;
  online: boolean;
  interactionObserved: boolean;
  protectedActionActive: boolean;
  blockingDomState: boolean;
}>;

export function isProtectedNativeActionPath(pathname: string): boolean {
  const normalized = pathname.toLowerCase().replace(/\/+$/, "") || "/";

  if (
    ALWAYS_PROTECTED_PREFIXES.some(
      (prefix) =>
        normalized === prefix || normalized.startsWith(`${prefix}/`),
    )
  ) {
    return true;
  }

  return normalized
    .split("/")
    .filter(Boolean)
    .some((segment) => PROTECTED_ACTION_SEGMENTS.has(segment));
}

export function shouldRequestSafeActivation(
  decision: SafeReopenDecision,
): boolean {
  return (
    decision.waitingWorkerFound &&
    decision.waitingVersionWasObservedBeforeBoot &&
    decision.visibilityState === "visible" &&
    decision.online &&
    !isProtectedNativeActionPath(decision.pathname) &&
    !decision.interactionObserved &&
    !decision.protectedActionActive &&
    !decision.blockingDomState
  );
}

export type WaitingWorkerMarker = Readonly<{
  version: string;
  observedAt: string;
}>;

export function parseWaitingWorkerMarker(
  raw: string | null,
): WaitingWorkerMarker | null {
  if (raw === null) return null;

  try {
    const value: unknown = JSON.parse(raw);
    if (
      typeof value === "object" &&
      value !== null &&
      "version" in value &&
      "observedAt" in value &&
      typeof value.version === "string" &&
      value.version.length > 0 &&
      typeof value.observedAt === "string" &&
      value.observedAt.length > 0
    ) {
      return {
        version: value.version,
        observedAt: value.observedAt,
      };
    }
  } catch {
    // Invalid or legacy state is treated as no observed update.
  }

  return null;
}

export function createWaitingWorkerMarker(version: string): string {
  return JSON.stringify({
    version,
    observedAt: new Date().toISOString(),
  } satisfies WaitingWorkerMarker);
}
