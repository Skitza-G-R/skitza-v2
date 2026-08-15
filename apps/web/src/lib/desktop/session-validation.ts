import {
  DESKTOP_CAPABILITIES,
  desktopBridgeHasCapability,
  detectDesktopBridge,
  parseDesktopBridgeEvent,
  type DesktopBridgeDetection,
  type DesktopBridgeEvent,
} from "./bridge";

export const DESKTOP_HIDDEN_VALIDATION_INTERVAL_MS = 55_000;
export const DESKTOP_PRIVATE_CACHE_VALIDATION_MAX_AGE_MS = 120_000;

export type DesktopSessionCacheAccess =
  | { kind: "web" }
  | {
      kind: "desktop";
      allowed: boolean;
      reason:
        | "valid"
        | "offline"
        | "unknown"
        | "stale"
        | "suspended"
        | "revoked"
        | "account-mismatch";
    };

interface DesktopSessionValidationState {
  accountId: string | null;
  status: "unknown" | "valid" | "invalid";
  suspended: boolean;
  validatedAt: number | null;
}

let state: DesktopSessionValidationState = {
  accountId: null,
  status: "unknown",
  suspended: false,
  validatedAt: null,
};
const listeners = new Set<() => void>();
let validationExpiryTimeout: ReturnType<typeof setTimeout> | null = null;

export function getBrowserOnlineSnapshot(): boolean {
  return typeof navigator === "undefined" ? true : navigator.onLine;
}

export function subscribeBrowserOnline(listener: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  window.addEventListener("online", listener);
  window.addEventListener("offline", listener);
  return () => {
    window.removeEventListener("online", listener);
    window.removeEventListener("offline", listener);
  };
}

function clearValidationExpiryTimeout(): void {
  if (validationExpiryTimeout) clearTimeout(validationExpiryTimeout);
  validationExpiryTimeout = null;
}

function emit(): void {
  for (const listener of listeners) listener();
}

export function subscribeDesktopSessionValidation(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function updateDesktopSessionValidation(input: {
  accountId: string;
  status: "valid" | "invalid";
  validatedAt?: number;
}): void {
  clearValidationExpiryTimeout();
  state = {
    accountId: input.accountId,
    status: input.status,
    suspended: false,
    validatedAt: input.validatedAt ?? Date.now(),
  };
  if (input.status === "valid") {
    const validatedAt = state.validatedAt;
    validationExpiryTimeout = setTimeout(() => {
      if (state.status === "valid" && state.validatedAt === validatedAt) {
        invalidateDesktopSessionValidation("unknown");
      }
    }, DESKTOP_PRIVATE_CACHE_VALIDATION_MAX_AGE_MS + 1);
    if (
      typeof validationExpiryTimeout === "object" &&
      "unref" in validationExpiryTimeout &&
      typeof validationExpiryTimeout.unref === "function"
    ) {
      validationExpiryTimeout.unref();
    }
  }
  emit();
}

export function invalidateDesktopSessionValidation(
  reason: "suspended" | "revoked" | "unknown" = "unknown",
): void {
  clearValidationExpiryTimeout();
  state = {
    ...state,
    status: reason === "revoked" ? "invalid" : "unknown",
    suspended: reason === "suspended",
    validatedAt: null,
  };
  emit();
}

export function resetDesktopSessionValidationForTests(): void {
  clearValidationExpiryTimeout();
  state = {
    accountId: null,
    status: "unknown",
    suspended: false,
    validatedAt: null,
  };
  emit();
}

export function desktopSessionCacheAccess(
  accountId: string | null,
  online: boolean,
  now = Date.now(),
  detection: DesktopBridgeDetection = detectDesktopBridge(),
): DesktopSessionCacheAccess {
  if (!desktopBridgeHasCapability(detection, DESKTOP_CAPABILITIES.sessionValidation)) {
    return detection.kind === "web"
      ? { kind: "web" }
      : { kind: "desktop", allowed: false, reason: "unknown" };
  }
  if (!online) return { kind: "desktop", allowed: false, reason: "offline" };
  if (state.suspended) {
    return { kind: "desktop", allowed: false, reason: "suspended" };
  }
  if (state.status === "invalid") {
    return { kind: "desktop", allowed: false, reason: "revoked" };
  }
  if (!accountId || !state.accountId) {
    return { kind: "desktop", allowed: false, reason: "unknown" };
  }
  if (state.accountId !== accountId) {
    return { kind: "desktop", allowed: false, reason: "account-mismatch" };
  }
  if (state.status !== "valid" || state.validatedAt === null) {
    return { kind: "desktop", allowed: false, reason: "unknown" };
  }
  if (
    state.validatedAt > now + 60_000 ||
    now - state.validatedAt > DESKTOP_PRIVATE_CACHE_VALIDATION_MAX_AGE_MS
  ) {
    return { kind: "desktop", allowed: false, reason: "stale" };
  }
  return { kind: "desktop", allowed: true, reason: "valid" };
}

export function desktopSavedScreenPreviewEnabled(
  detection: DesktopBridgeDetection = detectDesktopBridge(),
): boolean {
  return desktopBridgeHasCapability(detection, DESKTOP_CAPABILITIES.savedScreenPreview);
}

export function handleDesktopSessionEvent(event: DesktopBridgeEvent): void {
  if (event.type === "runtime-suspended") {
    invalidateDesktopSessionValidation("suspended");
  } else if (event.type === "session-revoked") {
    invalidateDesktopSessionValidation("revoked");
  }
}

export function installDesktopSessionEventListener(
  detection: DesktopBridgeDetection = detectDesktopBridge(),
): () => void {
  if (!desktopBridgeHasCapability(detection, DESKTOP_CAPABILITIES.sessionValidation)) {
    return () => undefined;
  }
  try {
    return detection.bridge.listen((value) => {
      const event = parseDesktopBridgeEvent(value);
      if (event) handleDesktopSessionEvent(event);
    });
  } catch {
    return () => undefined;
  }
}
