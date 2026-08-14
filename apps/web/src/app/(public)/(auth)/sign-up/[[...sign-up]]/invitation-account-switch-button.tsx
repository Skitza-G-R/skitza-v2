"use client";

import { useState } from "react";

import { useSafeSignOut } from "~/components/audio/app-media-runtime";
import { Button } from "~/components/ui/button";

/**
 * Clerk cannot consume an invitation ticket while another session is active.
 * Read the return URL from the browser so the secret ticket never becomes a
 * serialized Server Component prop, then return to the same local invitation
 * URL after the existing session is safely closed.
 */
export function InvitationAccountSwitchButton() {
  const signOut = useSafeSignOut();
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);

  const onClick = async () => {
    if (pending) return;
    setFailed(false);
    setPending(true);

    try {
      const returnUrl = `${window.location.pathname}${window.location.search}`;
      await signOut({ redirectUrl: returnUrl });
    } catch {
      setPending(false);
      setFailed(true);
    }
  };

  return (
    <div className="space-y-3">
      <Button
        type="button"
        size="lg"
        className="sk-cta-shine w-full rounded-[var(--radius-lg)] bg-gradient-to-br from-[rgb(var(--brand-primary))] to-[rgb(var(--brand-accent))] text-[#0C0A07]"
        disabled={pending}
        aria-describedby={failed ? "invitation-account-switch-error" : undefined}
        onClick={() => void onClick()}
      >
        {pending ? "Signing out…" : "Sign out and accept invitation"}
      </Button>
      {failed ? (
        <p
          id="invitation-account-switch-error"
          role="alert"
          className="text-center text-sm text-[rgb(var(--fg-danger-text))]"
        >
          Couldn&apos;t switch accounts. Try again.
        </p>
      ) : null}
    </div>
  );
}
