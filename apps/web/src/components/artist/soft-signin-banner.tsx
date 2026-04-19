"use client";

import Link from "next/link";
import { useState, useEffect } from "react";

// Rendered on magic-link surfaces. Two modes:
//   1. "Drive-by" — visitor is NOT signed in. Banner says "Sign in to
//      see all your studios" with a Continue with Google CTA.
//   2. "In-app" — visitor IS signed in AND their clerkUserId maps to
//      a clientContacts row for this project's producer. Banner says
//      "View in app" with a deep-link to /artist/music/[projectId].
//
// Dismissed state persists per-token via localStorage so a client who
// dismissed the banner on /share/<token> doesn't see it again on that
// same token. Different tokens → separate dismiss state.
type Props =
  | { mode: "signin"; token: string; returnUrl: string }
  | { mode: "in-app"; token: string; appUrl: string; studioName: string };

export function SoftSignInBanner(props: Props) {
  const [dismissed, setDismissed] = useState<boolean | null>(null);

  useEffect(() => {
    try {
      const key = `skitza:soft-signin-dismissed:${props.token}`;
      setDismissed(localStorage.getItem(key) === "1");
    } catch {
      setDismissed(false);
    }
  }, [props.token]);

  if (dismissed || dismissed === null) return null;

  const handleDismiss = () => {
    try {
      const key = `skitza:soft-signin-dismissed:${props.token}`;
      localStorage.setItem(key, "1");
    } catch {
      // localStorage unavailable (private mode, quota) — fall through
      // to in-memory dismissal so this tab stops showing the banner.
    }
    setDismissed(true);
  };

  if (props.mode === "signin") {
    return (
      <div
        role="status"
        className="mx-auto mb-4 flex max-w-2xl items-center justify-between gap-3 rounded-md border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-4 py-3"
      >
        <div className="min-w-0 text-sm">
          <span className="font-semibold">Sign in to see all your studios.</span>
          <span className="ml-1 text-[rgb(var(--fg-secondary))]">
            One place for every producer you work with.
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Link
            href={`/sign-in?redirect_url=${encodeURIComponent(props.returnUrl)}`}
            className="inline-flex min-h-[36px] items-center rounded-md bg-[rgb(var(--brand-primary))] px-3 text-xs font-semibold text-[rgb(var(--bg-base))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))] focus-visible:ring-offset-2 focus-visible:ring-offset-[rgb(var(--bg-elevated))]"
          >
            Continue with Google
          </Link>
          <button
            type="button"
            onClick={handleDismiss}
            aria-label="Dismiss"
            className="sk-tap flex items-center justify-center rounded-md text-[rgb(var(--fg-muted))] transition-colors hover:text-[rgb(var(--fg-primary))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))]"
          >
            ✕
          </button>
        </div>
      </div>
    );
  }

  // in-app mode
  return (
    <div
      role="status"
      className="mx-auto mb-4 flex max-w-2xl items-center justify-between gap-3 rounded-md border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-4 py-3"
    >
      <div className="min-w-0 text-sm">
        <span className="font-semibold">You&apos;re signed in.</span>
        <span className="ml-1 text-[rgb(var(--fg-secondary))]">
          Open {props.studioName} in the artist app.
        </span>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Link
          href={props.appUrl}
          className="inline-flex min-h-[36px] items-center rounded-md bg-[rgb(var(--brand-primary))] px-3 text-xs font-semibold text-[rgb(var(--bg-base))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))] focus-visible:ring-offset-2 focus-visible:ring-offset-[rgb(var(--bg-elevated))]"
        >
          View in app →
        </Link>
        <button
          type="button"
          onClick={handleDismiss}
          aria-label="Dismiss"
          className="sk-tap flex items-center justify-center rounded-md text-[rgb(var(--fg-muted))] transition-colors hover:text-[rgb(var(--fg-primary))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))]"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
