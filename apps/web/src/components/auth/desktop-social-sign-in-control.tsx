"use client";

import { useLayoutEffect, useState, type ReactNode } from "react";

import {
  DESKTOP_CAPABILITIES,
  desktopBridgeHasCapability,
  detectDesktopBridge,
  parseDesktopBridgeEvent,
  type SkitzaDesktopBridgeV1,
} from "~/lib/desktop/bridge";

const DESKTOP_SIGN_IN_ERROR_MESSAGE = "Could not complete sign-in. Please try again.";

export async function startDesktopGoogleSignIn(bridge: SkitzaDesktopBridgeV1): Promise<void> {
  if (typeof bridge.startSocialSignIn !== "function") {
    throw new Error("Desktop social sign-in is unavailable");
  }
  await bridge.startSocialSignIn("google");
}

export function listenForDesktopSocialSignInErrors(
  bridge: SkitzaDesktopBridgeV1,
  onError: () => void,
): () => void {
  try {
    return bridge.listen((value) => {
      if (parseDesktopBridgeEvent(value)?.type === "social-sign-in-error") {
        // Native error codes are deliberately not surfaced, retained, or logged.
        onError();
      }
    });
  } catch {
    return () => undefined;
  }
}

export function DesktopSocialSignInControl({ children }: { children: ReactNode }) {
  const [bridge, setBridge] = useState<SkitzaDesktopBridgeV1 | null>(null);
  const [opening, setOpening] = useState(false);
  const [hasError, setHasError] = useState(false);

  // The native bridge is injected before the remote page. Resolve it before
  // paint so a desktop user cannot accidentally start Clerk OAuth in WebView.
  useLayoutEffect(() => {
    const detection = detectDesktopBridge();
    if (
      !desktopBridgeHasCapability(detection, DESKTOP_CAPABILITIES.socialAuth) ||
      typeof detection.bridge.startSocialSignIn !== "function"
    ) {
      setBridge(null);
      return;
    }

    setBridge(detection.bridge);
    return listenForDesktopSocialSignInErrors(detection.bridge, () => {
      setOpening(false);
      setHasError(true);
    });
  }, []);

  return (
    <div
      className={
        bridge ? "w-full [&_.cl-dividerRow]:hidden [&_.cl-socialButtonsBlock]:hidden" : "w-full"
      }
    >
      {bridge ? (
        <div className="mb-4 w-full">
          <button
            aria-busy={opening}
            className="sk-press flex min-h-11 w-full items-center justify-center gap-2 rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-4 text-[13px] font-semibold text-[rgb(var(--fg-primary))] hover:bg-[rgb(var(--bg-overlay))] disabled:cursor-wait disabled:opacity-60"
            disabled={opening}
            onClick={() => {
              setHasError(false);
              setOpening(true);
              void startDesktopGoogleSignIn(bridge).catch(() => {
                setOpening(false);
                setHasError(true);
              });
            }}
            type="button"
          >
            <span aria-hidden="true" className="font-bold">
              G
            </span>
            Continue with Google
          </button>
          {hasError ? (
            <p className="mt-2 text-center text-xs text-[rgb(var(--fg-danger))]" role="alert">
              {DESKTOP_SIGN_IN_ERROR_MESSAGE}
            </p>
          ) : null}
        </div>
      ) : null}
      {children}
    </div>
  );
}
