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

  const onClick = async () => {
    if (pending) return;
    setPending(true);
    try {
      await signOut({ redirectUrl: "/" });
    } catch {
      // Re-enable on failure (network blip / Clerk hiccup) so the
      // artist can retry instead of being stuck on a dead control.
      setPending(false);
    }
  };

  return (
    <button
      type="button"
      onClick={() => void onClick()}
      disabled={pending}
      className="mt-2 inline-block text-sm text-[rgb(var(--brand-primary))] underline decoration-dotted underline-offset-2 disabled:opacity-60"
    >
      {pending ? "Signing out…" : "Sign out + click the invite from your email"}
    </button>
  );
}
