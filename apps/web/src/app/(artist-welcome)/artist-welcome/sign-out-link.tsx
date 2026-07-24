"use client";

import { useState } from "react";
import { useSafeSignOut } from "~/components/audio/app-media-runtime";

// Tiny client island for /artist-welcome. The page used to render
// `<Link href="/sign-out">`, but no /sign-out route exists — the
// link 404'd. Signing out is a client-only Clerk operation, so this
// mirrors the established pattern in sign-out-and-return-button.tsx
// (/sign-up/join/<slug>): `useClerk().signOut` clears the session,
// then lands the user on the public landing page where they can go
// click the invite from their email.
export function SignOutLink() {
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
      // Re-enable on failure (network blip / Clerk hiccup) so the
      // artist can retry instead of being stuck on a dead control.
      setPending(false);
      setError("Couldn’t sign out. Check your connection and try again.");
    }
  };

  return (
    <div className="flex flex-col items-center">
      <button
        type="button"
        onClick={() => void onClick()}
        disabled={pending}
        className="sk-press mt-2 inline-flex min-h-11 items-center rounded-[var(--radius-lg)] px-3 py-2 text-sm text-[rgb(var(--brand-primary))] underline decoration-dotted underline-offset-2 disabled:opacity-60"
      >
        {pending ? "Signing out…" : "Sign out + click the invite from your email"}
      </button>
      {error ? (
        <p role="alert" className="mt-2 text-sm text-[rgb(var(--fg-danger-text))]">
          {error}
        </p>
      ) : null}
    </div>
  );
}
