"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

// One-time explainer shown to artists after first sign-in. Triggered
// by a ?welcome=1 URL param (set by the book/success CTA + the Clerk
// post-signup redirect). On dismiss, the param is stripped from the
// URL so a back-nav doesn't re-open it. Also sets a localStorage flag
// to short-circuit future ?welcome=1 hits (a user linking
// /artist?welcome=1 into a chat + re-opening won't re-modal).
export function WelcomeModal() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (searchParams.get("welcome") !== "1") return;
    try {
      const seen = localStorage.getItem("skitza:artist:welcomed");
      if (seen === "1") {
        // Already dismissed — strip the param silently so a shared
        // /artist?welcome=1 URL doesn't pop the modal a second time.
        const p = new URLSearchParams(searchParams.toString());
        p.delete("welcome");
        const qs = p.toString();
        router.replace(qs ? `${pathname}?${qs}` : pathname);
        return;
      }
    } catch {
      // localStorage can throw in private-mode Safari; treat as
      // "not-yet-seen" and show the modal anyway.
    }
    setOpen(true);
  }, [searchParams, router, pathname]);

  const handleDismiss = () => {
    try {
      localStorage.setItem("skitza:artist:welcomed", "1");
    } catch {
      // Ignore — best-effort remember-dismissal.
    }
    const p = new URLSearchParams(searchParams.toString());
    p.delete("welcome");
    const qs = p.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname);
    setOpen(false);
  };

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="welcome-modal-title"
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 sm:items-center"
      onClick={handleDismiss}
    >
      <div
        onClick={(e) => {
          e.stopPropagation();
        }}
        className="w-full max-w-md rounded-lg border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-6 shadow-xl"
      >
        <h2
          id="welcome-modal-title"
          className="font-display text-xl tracking-tight"
        >
          Welcome to Skitza.
        </h2>
        <p className="mt-2 text-sm text-[rgb(var(--fg-secondary))]">
          Your project home. Four tabs, one always-on player.
        </p>
        <dl className="mt-5 space-y-3 text-sm">
          <div>
            <dt className="font-semibold">Home</dt>
            <dd className="text-[rgb(var(--fg-secondary))]">
              Your next session, newest mix, and anything due.
            </dd>
          </div>
          <div>
            <dt className="font-semibold">Music</dt>
            <dd className="text-[rgb(var(--fg-secondary))]">
              Listen and leave comments at specific timestamps.
            </dd>
          </div>
          <div>
            <dt className="font-semibold">Book</dt>
            <dd className="text-[rgb(var(--fg-secondary))]">
              Pick a slot that works for you — any day the producer is free.
            </dd>
          </div>
          <div>
            <dt className="font-semibold">Store</dt>
            <dd className="text-[rgb(var(--fg-secondary))]">
              Browse services like a single, album, or mix, and pay your way.
            </dd>
          </div>
        </dl>
        <button
          type="button"
          onClick={handleDismiss}
          className="mt-6 w-full rounded-md bg-[rgb(var(--brand-primary))] px-4 py-2 text-sm font-semibold text-[rgb(var(--bg-base))]"
        >
          Let&rsquo;s go
        </button>
      </div>
    </div>
  );
}
