"use client";

// SK-276 — one-time "turn on notifications" invitation shown at smart
// moments (artist just booked, artist sent a payment proof, producer finished
// onboarding). One tap enables every category via the shared flow. On iPhone
// Safari it invites installing the app instead, because iOS only allows push
// for Home-Screen apps. Renders nothing unless every eligibility check
// passes — it must never get in the host screen's way.

import { BellRing, Check } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { getPushStatusAction } from "~/app/push-actions";
import { enableAllPushCategories } from "~/lib/push/enable";
import {
  dismissPushInvite,
  pushInviteEligible,
  readPushInviteDismissedAt,
} from "~/lib/push/invite";
import {
  isAppleMobileDevice,
  isStandaloneDisplay,
  requestInstallGuidance,
} from "~/lib/pwa/install-guidance";

type BannerState = "hidden" | "invite" | "enabling" | "install" | "done";

export function PushMomentBanner({ message }: { message: string }) {
  const [state, setState] = useState<BannerState>("hidden");
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function evaluate() {
      const dismissedAt = readPushInviteDismissedAt();
      const now = Date.now();
      const supported =
        "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

      if (!supported) {
        // iPhone Safari: same dismissal window, but the ask is to install.
        // `supported: true` here means "the install invitation itself is
        // viable" — the real gate is the dismissal timer.
        const installInviteOpen = pushInviteEligible({
          supported: true,
          permission: "default",
          subscribed: false,
          dismissedAt,
          now,
        });
        const platformValue: unknown = Reflect.get(navigator, "platform");
        if (
          installInviteOpen &&
          isAppleMobileDevice({
            userAgent: navigator.userAgent,
            platform: typeof platformValue === "string" ? platformValue : "",
            maxTouchPoints: navigator.maxTouchPoints,
          }) &&
          !isStandaloneDisplay() &&
          !cancelled
        ) {
          setState("install");
        }
        return;
      }

      try {
        const registration = await navigator.serviceWorker.getRegistration();
        const subscription =
          registration && "pushManager" in registration
            ? await registration.pushManager.getSubscription()
            : null;
        if (
          !pushInviteEligible({
            supported: true,
            permission: Notification.permission,
            subscribed: subscription !== null,
            dismissedAt,
            now,
          })
        ) {
          return;
        }

        const status = await getPushStatusAction(null);
        if (cancelled || !status.ok || !status.configured || !status.publicKey) return;
        setPublicKey(status.publicKey);
        setState("invite");
      } catch {
        // The invitation is optional — any failure keeps it hidden.
      }
    }

    void evaluate();
    return () => {
      cancelled = true;
    };
  }, []);

  const turnOn = useCallback(async () => {
    if (!publicKey) return;
    setState("enabling");
    setError(null);
    const result = await enableAllPushCategories(publicKey);
    if (result.ok) {
      setState("done");
      return;
    }
    if (result.reason === "boundary") {
      setState("hidden");
      return;
    }
    setError(result.message);
    setState("invite");
  }, [publicKey]);

  const notNow = useCallback(() => {
    dismissPushInvite();
    setState("hidden");
  }, []);

  if (state === "hidden") return null;

  if (state === "done") {
    return (
      <div
        role="status"
        className="mt-4 flex items-center gap-3 rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-4 shadow-[var(--shadow-sm)]"
      >
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[rgb(var(--brand-primary)/0.14)] text-[rgb(var(--brand-primary))]">
          <Check size={16} aria-hidden />
        </span>
        <p className="text-sm font-bold text-[rgb(var(--fg-default))]">
          You&apos;re set. We&apos;ll let you know here.
        </p>
      </div>
    );
  }

  const install = state === "install";

  return (
    <div className="mt-4 rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-4 shadow-[var(--shadow-sm)]">
      <div className="flex gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[rgb(var(--brand-primary)/0.14)] text-[rgb(var(--brand-primary))]">
          <BellRing size={16} aria-hidden />
        </span>
        <p className="text-sm leading-relaxed font-semibold text-[rgb(var(--fg-default))]">
          {install
            ? "Get updates on your iPhone — add Skitza to your Home Screen first."
            : message}
        </p>
      </div>
      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          disabled={state === "enabling"}
          onClick={() => {
            if (install) {
              requestInstallGuidance();
              return;
            }
            void turnOn();
          }}
          className="inline-flex min-h-11 flex-1 items-center justify-center rounded-[var(--radius-lg)] bg-[rgb(var(--fg-default))] px-4 text-[12px] font-bold text-[rgb(var(--bg-elevated))] transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-[rgb(var(--focus-ring))] focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
        >
          {install ? "Show me how" : state === "enabling" ? "Turning on…" : "Turn on"}
        </button>
        <button
          type="button"
          onClick={notNow}
          className="inline-flex min-h-11 items-center justify-center rounded-[var(--radius-lg)] px-3 text-[12px] font-bold text-[rgb(var(--fg-muted))] transition-colors hover:text-[rgb(var(--fg-default))] focus-visible:ring-2 focus-visible:ring-[rgb(var(--focus-ring))] focus-visible:outline-none"
        >
          Not now
        </button>
      </div>
      {error ? (
        <p role="status" className="mt-2 text-xs text-[rgb(var(--status-danger))]">
          {error}
        </p>
      ) : null}
    </div>
  );
}
