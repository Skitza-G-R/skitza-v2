"use client";

import { useState } from "react";
import { useSafeSignOut } from "~/components/audio/app-media-runtime";

// Tiny client island for /producer-access. A signed-in account with no
// Producer or Artist membership gets bounced back here from every route
// ("/" → /auth/resolve → postSignInDestination → /producer-access), so a
// plain `<Link href="/">` loops forever — the only real exit is ending the
// session. Signing out is a client-only Clerk operation, so this mirrors
// the established pattern in sign-out-link.tsx (/artist-welcome):
// `useClerk().signOut` clears the session, then lands on the public
// landing page, which no longer redirects an unauthenticated visitor.
export function SignOutHomeButton({ label }: { label: string }) {
  const signOut = useSafeSignOut();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onClick = async () => {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      await signOut({ redirectUrl: "/" });
    } catch {
      // Re-enable on failure (network blip / Clerk hiccup) so the visitor
      // can retry instead of being stuck on a dead control.
      setPending(false);
      setError("Couldn’t sign out. Check your connection and try again.");
    }
  };

  return (
    <span className="inline-flex flex-col">
      <button
        type="button"
        onClick={() => void onClick()}
        disabled={pending}
        className="sk-press inline-flex min-h-11 items-center rounded-[var(--radius-lg)] border border-[rgb(var(--border-default))] px-4 font-semibold text-[rgb(var(--fg-default))] hover:bg-[rgb(var(--bg-overlay))] disabled:opacity-60"
      >
        {pending ? "Signing out…" : label}
      </button>
      {error ? (
        <span role="alert" className="mt-2 text-sm text-[rgb(var(--fg-danger-text))]">
          {error}
        </span>
      ) : null}
    </span>
  );
}
