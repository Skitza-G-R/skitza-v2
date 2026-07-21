"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "~/components/ui/dialog";

// One-time explainer shown to artists after first sign-in. Triggered
// by a ?welcome=1 URL param (set by the Clerk post-signup redirect
// from `/join/<slug>`; previously also set by the retired public
// `/p/<slug>/book/success` page — removed in Story 03 per PRD §6.6).
// On dismiss, the param is stripped from the URL so a back-nav
// doesn't re-open it. Also sets a localStorage flag to short-circuit
// future ?welcome=1 hits (a user linking /artist?welcome=1 into a
// chat + re-opening won't re-modal).
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

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && open) handleDismiss();
      }}
    >
      <DialogContent className="gap-0 p-6 sm:max-w-md">
        <DialogTitle className="pr-12 text-xl">
          Welcome to Skitza.
        </DialogTitle>
        <DialogDescription className="mt-2 text-[rgb(var(--fg-secondary))]">
          Your project home. Five tabs, one always-on player.
        </DialogDescription>
        <dl className="mt-5 space-y-3 text-sm">
          <div>
            <dt className="font-semibold">Home</dt>
            <dd className="text-[rgb(var(--fg-secondary))]">
              Sessions, new mixes, and anything due.
            </dd>
          </div>
          <div>
            <dt className="font-semibold">Music</dt>
            <dd className="text-[rgb(var(--fg-secondary))]">
              Listen, review, and comment at exact timestamps.
            </dd>
          </div>
          <div>
            <dt className="font-semibold">Book</dt>
            <dd className="text-[rgb(var(--fg-secondary))]">
              Choose an available time with the selected studio.
            </dd>
          </div>
          <div>
            <dt className="font-semibold">Store</dt>
            <dd className="text-[rgb(var(--fg-secondary))]">
              Browse products and services from the selected studio.
            </dd>
          </div>
          <div>
            <dt className="font-semibold">Payments</dt>
            <dd className="text-[rgb(var(--fg-secondary))]">
              See what is due, follow instructions, and review your history.
            </dd>
          </div>
        </dl>
        <button
          type="button"
          autoFocus
          onClick={handleDismiss}
          className="mt-6 min-h-11 w-full rounded-[var(--radius-lg)] bg-[rgb(var(--brand-primary))] px-4 py-2 text-sm font-semibold text-[rgb(var(--bg-base))]"
        >
          Let&rsquo;s go
        </button>
      </DialogContent>
    </Dialog>
  );
}
