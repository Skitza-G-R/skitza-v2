"use client";

import { useClerk } from "@clerk/nextjs";
import { useState } from "react";

// Tiny client island for the producer-already-signed-in branch of
// /sign-up/join/<slug>. The page is a server component, but signing
// out is a client-only Clerk operation — `useClerk().signOut` clears
// the session cookie + then navigates to `redirectUrl`. Returning the
// user to /join/<slug> (NOT /sign-up/join/<slug>) is intentional: once
// the producer's session is cleared, we want them on the public page
// again, where they can choose a different account or sign up fresh
// as an artist via the same "Book a session" CTA.

export function SignOutAndReturnButton({ slug }: { slug: string }) {
  const { signOut } = useClerk();
  const [pending, setPending] = useState(false);

  const onClick = async () => {
    if (pending) return;
    setPending(true);
    try {
      await signOut({ redirectUrl: `/join/${slug}` });
    } catch {
      // If signOut throws (network blip, Clerk hiccup) we re-enable the
      // button so the visitor can retry rather than being stuck on a
      // greyed-out CTA. Errors are surfaced to PostHog/Sentry via the
      // global Clerk error boundary.
      setPending(false);
    }
  };

  return (
    <button
      type="button"
      onClick={() => void onClick()}
      disabled={pending}
      className={[
        "sk-cta-shine inline-flex min-h-12 w-full items-center justify-center",
        "rounded-[var(--radius-md)] bg-gradient-to-br from-[rgb(var(--brand-primary))] to-[rgb(var(--brand-accent))]",
        "px-6 py-3 text-sm font-semibold text-[#0C0A07]",
        "transition-transform hover:scale-[1.02] hover:-translate-y-[1px] active:translate-y-[1px]",
        "disabled:opacity-60 disabled:hover:scale-100 disabled:hover:translate-y-0",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))] focus-visible:ring-offset-2 focus-visible:ring-offset-[rgb(var(--bg-base))]",
      ].join(" ")}
    >
      {pending ? "Signing out…" : "Sign out and continue"}
    </button>
  );
}
