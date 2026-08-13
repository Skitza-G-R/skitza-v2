"use client";

import { useAuth } from "@clerk/nextjs";
import { useEffect } from "react";
import { clearMediaForRevokedAccount } from "~/components/audio/app-media-runtime";

import {
  DESKTOP_CAPABILITIES,
  desktopBridgeHasCapability,
  detectDesktopBridge,
  parseDesktopBridgeEvent,
} from "~/lib/desktop/bridge";
import {
  installGate1ProofController,
  recordGate1CurrentScreenAfterReveal,
  startGate1JourneyAt,
} from "~/lib/desktop/gate1-proof";
import {
  DESKTOP_HIDDEN_VALIDATION_INTERVAL_MS,
  invalidateDesktopSessionValidation,
  updateDesktopSessionValidation,
} from "~/lib/desktop/session-validation";
import { clearAccountPrivateRuntimeState } from "~/lib/runtime-state/account-exit";

async function clearRevokedDesktopAccount(accountId: string | null): Promise<void> {
  if (!accountId) return;
  clearAccountPrivateRuntimeState(accountId);
  await clearMediaForRevokedAccount(accountId).catch(() => undefined);
}

let liveValidationGeneration = 0;
let liveValidationAbort: AbortController | null = null;

export function cancelLiveDesktopSessionValidation(): void {
  liveValidationGeneration += 1;
  liveValidationAbort?.abort();
  liveValidationAbort = null;
}

export async function requestLiveDesktopSessionValidation(
  accountId: string | null,
  detection = detectDesktopBridge(),
): Promise<void> {
  if (
    !desktopBridgeHasCapability(detection, DESKTOP_CAPABILITIES.sessionValidation) ||
    !accountId
  ) {
    cancelLiveDesktopSessionValidation();
    return;
  }
  cancelLiveDesktopSessionValidation();
  const requestGeneration = liveValidationGeneration;
  const abort = new AbortController();
  liveValidationAbort = abort;
  const isCurrentRequest = () =>
    requestGeneration === liveValidationGeneration &&
    liveValidationAbort === abort &&
    !abort.signal.aborted;
  try {
    const response = await fetch("/api/desktop/session", {
      cache: "no-store",
      credentials: "same-origin",
      headers: { Accept: "application/json" },
      signal: abort.signal,
    });
    if (!isCurrentRequest()) return;
    if (response.status === 401 || response.status === 403) {
      invalidateDesktopSessionValidation("revoked");
      await clearRevokedDesktopAccount(accountId);
      if (!isCurrentRequest()) return;
      void detection.bridge.reportSessionValidation?.({
        accountMatches: false,
        status: "invalid",
        validatedAt: null,
      });
      return;
    }
    if (!response.ok) throw new Error("session validation failed");
    const report = (await response.json()) as unknown;
    if (!isCurrentRequest()) return;
    if (
      typeof report === "object" &&
      report !== null &&
      (report as Record<string, unknown>).active === true &&
      (report as Record<string, unknown>).accountId === accountId
    ) {
      const validatedAt = Date.now();
      updateDesktopSessionValidation({
        accountId,
        status: "valid",
        validatedAt,
      });
      void detection.bridge.reportSessionValidation?.({
        accountMatches: true,
        status: "valid",
        validatedAt,
      });
      return;
    }
    invalidateDesktopSessionValidation("revoked");
    await clearRevokedDesktopAccount(accountId);
    if (!isCurrentRequest()) return;
    void detection.bridge.reportSessionValidation?.({
      accountMatches: false,
      status: "invalid",
      validatedAt: null,
    });
  } catch {
    if (!isCurrentRequest()) return;
    invalidateDesktopSessionValidation("unknown");
    void detection.bridge.reportSessionValidation?.({
      accountMatches: false,
      status: "unknown",
      validatedAt: null,
    });
  } finally {
    if (isCurrentRequest()) liveValidationAbort = null;
  }
}

export function isProtectedDesktopAuthorizationFailure(
  request: RequestInfo | URL,
  response: Response,
): boolean {
  if (response.status !== 401 && response.status !== 403) return false;
  const rawUrl =
    request instanceof Request ? request.url : request instanceof URL ? request.href : request;
  const url = new URL(rawUrl, window.location.origin);
  if (url.origin !== window.location.origin) return false;
  return (
    url.pathname.startsWith("/api/trpc/") ||
    url.pathname === "/api/trpc" ||
    url.pathname.startsWith("/api/audio/stream/") ||
    url.pathname.startsWith("/api/desktop/session") ||
    url.pathname === "/api/runtime/queue-version" ||
    url.pathname.startsWith("/dashboard") ||
    url.pathname.startsWith("/artist") ||
    url.pathname.startsWith("/launch/resolve")
  );
}

export function DesktopRuntimeBridge() {
  const { isLoaded, userId } = useAuth();

  useEffect(() => {
    installGate1ProofController();
    const detection = detectDesktopBridge();
    if (detection.kind !== "supported") return;
    const accountId = isLoaded ? (userId ?? null) : null;
    if (desktopBridgeHasCapability(detection, DESKTOP_CAPABILITIES.sessionValidation)) {
      void requestLiveDesktopSessionValidation(accountId, detection);
    }
    const originalFetch = window.fetch.bind(window);
    const desktopFetch: typeof window.fetch = async (request, init) => {
      const response = await originalFetch(request, init);
      if (
        accountId &&
        desktopBridgeHasCapability(detection, DESKTOP_CAPABILITIES.sessionValidation) &&
        isProtectedDesktopAuthorizationFailure(request, response)
      ) {
        cancelLiveDesktopSessionValidation();
        invalidateDesktopSessionValidation("revoked");
        void clearRevokedDesktopAccount(accountId);
        void detection.bridge.reportSessionValidation?.({
          accountMatches: false,
          status: "invalid",
          validatedAt: null,
        });
      }
      return response;
    };
    if (desktopBridgeHasCapability(detection, DESKTOP_CAPABILITIES.sessionValidation)) {
      window.fetch = desktopFetch;
    }
    const reportUnknownSession = () => {
      cancelLiveDesktopSessionValidation();
      invalidateDesktopSessionValidation("unknown");
      void detection.bridge.reportSessionValidation?.({
        accountMatches: false,
        status: "unknown",
        validatedAt: null,
      });
    };
    const onOffline = () => {
      reportUnknownSession();
    };
    const onOnline = () => {
      void requestLiveDesktopSessionValidation(accountId, detection);
    };
    if (desktopBridgeHasCapability(detection, DESKTOP_CAPABILITIES.sessionValidation)) {
      window.addEventListener("offline", onOffline);
      window.addEventListener("online", onOnline);
    }
    let disposed = false;
    let validationInterval: number | null = null;
    if (desktopBridgeHasCapability(detection, DESKTOP_CAPABILITIES.sessionValidation)) {
      validationInterval = window.setInterval(() => {
        if (!disposed && document.visibilityState === "hidden") {
          void requestLiveDesktopSessionValidation(accountId, detection);
        }
      }, DESKTOP_HIDDEN_VALIDATION_INTERVAL_MS);
    }

    let unlisten: () => void = () => undefined;
    try {
      unlisten = detection.bridge.listen((value) => {
        const event = parseDesktopBridgeEvent(value);
        if (!event) return;
        if (event.type === "runtime-suspended") {
          cancelLiveDesktopSessionValidation();
          invalidateDesktopSessionValidation("suspended");
          return;
        }
        if (event.type === "session-revoked") {
          cancelLiveDesktopSessionValidation();
          invalidateDesktopSessionValidation("revoked");
          void clearRevokedDesktopAccount(accountId);
          return;
        }
        if (event.type === "session-validation-requested") {
          void requestLiveDesktopSessionValidation(accountId, detection);
          return;
        }
        if (
          event.type === "window-revealed" &&
          desktopBridgeHasCapability(detection, DESKTOP_CAPABILITIES.performanceProof)
        ) {
          Promise.resolve(detection.bridge.consumeRevealElapsedMs?.())
            .then((elapsedMs) => {
              if (typeof elapsedMs === "number" && Number.isFinite(elapsedMs) && elapsedMs >= 0) {
                startGate1JourneyAt("reopen-today", Math.max(0, performance.now() - elapsedMs));
                recordGate1CurrentScreenAfterReveal();
              }
            })
            .catch(() => undefined);
        }
      });
    } catch {
      unlisten = () => undefined;
    }
    return () => {
      disposed = true;
      cancelLiveDesktopSessionValidation();
      if (validationInterval !== null) window.clearInterval(validationInterval);
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("online", onOnline);
      if (window.fetch === desktopFetch) window.fetch = originalFetch;
      unlisten();
    };
  }, [isLoaded, userId]);

  return null;
}
