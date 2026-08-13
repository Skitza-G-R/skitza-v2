export const DESKTOP_BRIDGE_PROTOCOL_VERSION = 1 as const;

export const DESKTOP_CAPABILITIES = {
  performanceProof: "performance-proof-v1",
  savedScreenPreview: "saved-screen-preview-v1",
  sessionValidation: "session-validation-v1",
  socialAuth: "social-auth-v1",
} as const;

export type DesktopCapability = (typeof DESKTOP_CAPABILITIES)[keyof typeof DESKTOP_CAPABILITIES];

export type DesktopBridgeEvent =
  | { type: "window-revealed" }
  | { type: "session-validation-requested" }
  | { type: "runtime-suspended" }
  | { type: "session-revoked" }
  | { type: "social-sign-in-error"; code: DesktopSocialSignInErrorCode }
  | { type: "social-sign-in-ticket"; ticket: string };

export const DESKTOP_SOCIAL_SIGN_IN_ERROR_CODES = [
  "callback-invalid",
  "auth-state-invalid",
  "auth-state-unavailable",
  "exchange-failed",
  "webview-untrusted",
  "webview-unavailable",
  "ticket-delivery-failed",
] as const;

export type DesktopSocialSignInErrorCode = (typeof DESKTOP_SOCIAL_SIGN_IN_ERROR_CODES)[number];

export interface DesktopSessionValidationReport {
  accountMatches: boolean;
  status: "valid" | "invalid" | "unknown";
  validatedAt: number | null;
}

export interface DesktopGate1Sample {
  blankOrFullscreenSpinner: boolean;
  bridgeProtocolVersion: number | null;
  buildId: string;
  durationMs: number;
  journey: "reopen-today" | "safe-clients-projects" | "cached-recent-audio";
  meaningful: boolean;
  mediaDownloadRequests: number;
  origin: string;
  phase: "warmup" | "timed";
  platform: "macos" | "windows" | "unknown";
  run: number;
  runtime: "chrome" | "desktop";
  source: "recent-cache" | "network" | "resume" | "safe-view" | "server" | null;
}

/**
 * Injected by the trusted Tauri initialization script before the remote page
 * runs. Every method is a high-level operation; the web app never receives a
 * generic native command, filesystem, shell, or process primitive.
 */
export interface SkitzaDesktopBridgeV1 {
  readonly protocolVersion: 1;
  readonly capabilities: readonly string[];
  listen(listener: (event: unknown) => void): () => void;
  consumeRevealElapsedMs?(): Promise<number | null> | number | null;
  exportGate1Samples?(): Promise<readonly DesktopGate1Sample[]>;
  recordGate1Sample?(sample: DesktopGate1Sample): Promise<void> | void;
  reportSessionValidation?(report: DesktopSessionValidationReport): Promise<void> | void;
  startSocialSignIn?(provider: string): Promise<void> | void;
}

export type DesktopBridgeDetection =
  | { kind: "web" }
  | { kind: "unsupported"; protocolVersion: number | null }
  | { kind: "supported"; bridge: SkitzaDesktopBridgeV1 };

declare global {
  interface Window {
    __SKITZA_DESKTOP__?: unknown;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function protocolVersionFrom(value: unknown): number | null {
  if (!isRecord(value)) return null;
  return typeof value.protocolVersion === "number" && Number.isSafeInteger(value.protocolVersion)
    ? value.protocolVersion
    : null;
}

export function detectDesktopBridge(
  value: unknown = typeof window === "undefined" ? undefined : window.__SKITZA_DESKTOP__,
): DesktopBridgeDetection {
  if (value === undefined) return { kind: "web" };
  const protocolVersion = protocolVersionFrom(value);
  if (
    !isRecord(value) ||
    protocolVersion !== DESKTOP_BRIDGE_PROTOCOL_VERSION ||
    !Array.isArray(value.capabilities) ||
    !value.capabilities.every(
      (capability) => typeof capability === "string" && capability.length <= 80,
    ) ||
    typeof value.listen !== "function"
  ) {
    return { kind: "unsupported", protocolVersion };
  }

  return { kind: "supported", bridge: value as unknown as SkitzaDesktopBridgeV1 };
}

export function desktopBridgeHasCapability(
  detection: DesktopBridgeDetection,
  capability: DesktopCapability,
): detection is Extract<DesktopBridgeDetection, { kind: "supported" }> {
  return detection.kind === "supported" && detection.bridge.capabilities.includes(capability);
}

export function parseDesktopBridgeEvent(value: unknown): DesktopBridgeEvent | null {
  if (!isRecord(value) || typeof value.type !== "string") return null;
  switch (value.type) {
    case "window-revealed":
    case "session-validation-requested":
    case "runtime-suspended":
    case "session-revoked":
      return Object.keys(value).length === 1 ? ({ type: value.type } as DesktopBridgeEvent) : null;
    case "social-sign-in-ticket":
      return Object.keys(value).length === 2 &&
        typeof value.ticket === "string" &&
        value.ticket.length > 0 &&
        value.ticket.length <= 4096
        ? { type: value.type, ticket: value.ticket }
        : null;
    case "social-sign-in-error":
      return Object.keys(value).length === 2 &&
        typeof value.code === "string" &&
        DESKTOP_SOCIAL_SIGN_IN_ERROR_CODES.includes(value.code as DesktopSocialSignInErrorCode)
        ? { type: value.type, code: value.code as DesktopSocialSignInErrorCode }
        : null;
    default:
      return null;
  }
}
