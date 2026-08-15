"use client";

import { useState } from "react";

import { useSafeSignOut } from "~/components/audio/app-media-runtime";
import { Button } from "~/components/ui/button";
import type { JoinContinuationAction } from "~/server/auth/join-intent";
import { joinSignInHref } from "~/server/auth/post-sign-in";

export function JoinAccountSwitchButton({
  slug,
  action,
  offerId,
}: {
  slug: string;
  action: JoinContinuationAction;
  offerId?: string;
}) {
  const signOut = useSafeSignOut();
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);

  const onClick = async () => {
    if (pending) return;
    setFailed(false);
    setPending(true);
    try {
      await signOut({ redirectUrl: joinSignInHref(slug, action, offerId) });
    } catch {
      setPending(false);
      setFailed(true);
    }
  };

  return (
    <div className="space-y-2">
      <Button
        type="button"
        size="lg"
        className="sk-cta-shine w-full rounded-[var(--radius-lg)] bg-gradient-to-br from-[rgb(var(--brand-primary))] to-[rgb(var(--brand-accent))] text-[#0C0A07]"
        disabled={pending}
        aria-describedby={failed ? "join-account-switch-error" : undefined}
        onClick={() => void onClick()}
      >
        {pending
          ? "Signing out…"
          : action === "offer"
            ? "Switch account"
            : "Sign out and choose account"}
      </Button>
      {failed ? (
        <p
          id="join-account-switch-error"
          role="alert"
          className="text-center text-sm text-[rgb(var(--fg-danger-text))]"
        >
          Couldn&apos;t sign out. Try again.
        </p>
      ) : null}
    </div>
  );
}
