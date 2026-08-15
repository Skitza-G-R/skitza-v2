export const INSTALL_DISMISS_MS = 90 * 24 * 60 * 60 * 1000;
export const INSTALL_PROMPT_AVAILABLE_EVENT = "skitza:native-install-prompt-available";
export const INSTALL_GUIDANCE_OPEN_EVENT = "skitza:native-install-guidance-open";
export const INSTALL_STATE_CHANGED_EVENT = "skitza:native-install-state-changed";

const ACTION_STORAGE_KEY = "skitza:native-install-action:v1";
const DISMISSED_STORAGE_KEY = "skitza:native-install-dismissed:v1";
const INSTALLED_STORAGE_KEY = "skitza:native-installed:v1";
const SESSION_STORAGE_KEY = "skitza:native-install-session:v1";

export interface NativeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

export type InstallActionMarker = Readonly<{
  completedAt: number;
  sessionId: string;
}>;

let capturedPrompt: NativeInstallPromptEvent | null = null;

function storageRead(storage: Storage, key: string): string | null {
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

function storageWrite(storage: Storage, key: string, value: string): void {
  try {
    storage.setItem(key, value);
  } catch {
    // Install guidance is optional when browser storage is unavailable.
  }
}

function storageRemove(storage: Storage, key: string): void {
  try {
    storage.removeItem(key);
  } catch {
    // Install guidance remains usable when browser storage is unavailable.
  }
}

function dismissalExpired(dismissedAt: number | null, now: number): boolean {
  return (
    dismissedAt === null || !Number.isFinite(dismissedAt) || now - dismissedAt >= INSTALL_DISMISS_MS
  );
}

export function parseInstallActionMarker(value: string | null): InstallActionMarker | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      !("completedAt" in parsed) ||
      !("sessionId" in parsed) ||
      typeof parsed.completedAt !== "number" ||
      !Number.isFinite(parsed.completedAt) ||
      typeof parsed.sessionId !== "string" ||
      parsed.sessionId.length < 8 ||
      parsed.sessionId.length > 128
    ) {
      return null;
    }
    return {
      completedAt: parsed.completedAt,
      sessionId: parsed.sessionId,
    };
  } catch {
    return null;
  }
}

export function installGuidanceEligible(
  input: Readonly<{
    signedIn: boolean;
    installed: boolean;
    standalone: boolean;
    currentSessionId: string;
    action: InstallActionMarker | null;
    dismissedAt: number | null;
    now: number;
  }>,
): boolean {
  if (
    !input.signedIn ||
    input.installed ||
    input.standalone ||
    !input.action ||
    input.action.sessionId === input.currentSessionId ||
    input.action.completedAt > input.now
  ) {
    return false;
  }
  return dismissalExpired(input.dismissedAt, input.now);
}

export function mobileInstallGuidanceEligible(
  input: Readonly<{
    signedIn: boolean;
    installed: boolean;
    standalone: boolean;
    dismissedAt: number | null;
    now: number;
  }>,
): boolean {
  if (!input.signedIn || input.installed || input.standalone) return false;
  return dismissalExpired(input.dismissedAt, input.now);
}

export function currentInstallSessionId(): string {
  if (typeof window === "undefined") return "server-session";
  const existing = storageRead(window.sessionStorage, SESSION_STORAGE_KEY);
  if (existing && existing.length >= 8 && existing.length <= 128) {
    return existing;
  }
  const created = crypto.randomUUID();
  storageWrite(window.sessionStorage, SESSION_STORAGE_KEY, created);
  return created;
}

export function markMeaningfulInstallAction(now = Date.now()): void {
  if (typeof window === "undefined") return;
  storageWrite(
    window.localStorage,
    ACTION_STORAGE_KEY,
    JSON.stringify({
      completedAt: now,
      sessionId: currentInstallSessionId(),
    } satisfies InstallActionMarker),
  );
}

export function dismissInstallGuidance(now = Date.now()): void {
  if (typeof window === "undefined") return;
  storageWrite(window.localStorage, DISMISSED_STORAGE_KEY, String(now));
}

export function markNativeAppInstalled(): void {
  if (typeof window === "undefined") return;
  storageWrite(window.localStorage, INSTALLED_STORAGE_KEY, "true");
  window.dispatchEvent(new Event(INSTALL_STATE_CHANGED_EVENT));
}

export function readInstallGuidanceState(now = Date.now()) {
  const sessionId = currentInstallSessionId();
  const action = parseInstallActionMarker(storageRead(window.localStorage, ACTION_STORAGE_KEY));
  const dismissedRaw = storageRead(window.localStorage, DISMISSED_STORAGE_KEY);
  const dismissedAt =
    dismissedRaw === null || dismissedRaw.trim() === "" ? null : Number(dismissedRaw);
  return {
    sessionId,
    action,
    dismissedAt,
    installed: storageRead(window.localStorage, INSTALLED_STORAGE_KEY) === "true",
    now,
  };
}

export function captureNativeInstallPrompt(event: NativeInstallPromptEvent): void {
  event.preventDefault();
  capturedPrompt = event;
  if (typeof window !== "undefined") {
    // A fresh browser prompt is stronger evidence than our prior local marker.
    // It can reappear after uninstall, so make installation discoverable again.
    storageRemove(window.localStorage, INSTALLED_STORAGE_KEY);
    window.dispatchEvent(new Event(INSTALL_PROMPT_AVAILABLE_EVENT));
    window.dispatchEvent(new Event(INSTALL_STATE_CHANGED_EVENT));
  }
}

export function capturedNativeInstallPrompt(): NativeInstallPromptEvent | null {
  return capturedPrompt;
}

export function clearCapturedNativeInstallPrompt(): void {
  capturedPrompt = null;
}

export function requestInstallGuidance(returnFocusTo?: HTMLElement): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(INSTALL_GUIDANCE_OPEN_EVENT, {
      detail: { returnFocusTo },
    }),
  );
}

export function isStandaloneDisplay(): boolean {
  if (typeof window === "undefined") return false;
  const navigatorWithStandalone = navigator as Navigator & {
    standalone?: boolean;
  };
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    navigatorWithStandalone.standalone === true
  );
}

export function isIphoneLike(userAgent: string): boolean {
  return /(?:iphone|ipad|ipod)/i.test(userAgent);
}

export type InstallDeviceInfo = Readonly<{
  userAgent: string;
  platform?: string;
  maxTouchPoints?: number;
}>;

export function isAppleMobileDevice({
  userAgent,
  platform = "",
  maxTouchPoints = 0,
}: InstallDeviceInfo): boolean {
  return isIphoneLike(userAgent) || (platform === "MacIntel" && maxTouchPoints > 1);
}

export function isMobileInstallDevice(device: InstallDeviceInfo): boolean {
  return isAppleMobileDevice(device) || /(?:android|mobile)/i.test(device.userAgent);
}
