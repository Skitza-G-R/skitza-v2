"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { useSafeSignOut } from "~/components/audio/app-media-runtime";
import { INVITATION_SIGNUP_HANDOFF_KEY } from "~/components/auth/invitation-signup-marker";
import { Button } from "~/components/ui/button";

export function InvitationSignInHandoff({
  handoffToken,
  signInHref,
}: {
  handoffToken: string;
  signInHref: string;
}) {
  const signOut = useSafeSignOut();
  const started = useRef(false);
  const [pending, setPending] = useState(true);
  const [failed, setFailed] = useState(false);
  const [invalidHandoff, setInvalidHandoff] = useState(false);

  const continueToSignIn = useCallback(async () => {
    setPending(true);
    setFailed(false);
    setInvalidHandoff(false);

    if (window.sessionStorage.getItem(INVITATION_SIGNUP_HANDOFF_KEY) !== handoffToken) {
      setPending(false);
      setInvalidHandoff(true);
      return;
    }

    try {
      // Clerk creates an active session when a new invitee finishes their
      // password. End that one-time signup session so the next screen is a
      // genuine sign-in, then `/auth/resolve` can claim the accepted invite.
      await signOut({ redirectUrl: signInHref });
      window.sessionStorage.removeItem(INVITATION_SIGNUP_HANDOFF_KEY);
    } catch {
      setPending(false);
      setFailed(true);
    }
  }, [handoffToken, signInHref, signOut]);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void continueToSignIn();
  }, [continueToSignIn]);

  return (
    <div className="space-y-3">
      {invalidHandoff ? null : (
        <Button
          type="button"
          size="lg"
          className="w-full rounded-[var(--radius-lg)]"
          disabled={pending}
          onClick={() => void continueToSignIn()}
        >
          {pending ? "Opening sign in…" : "Continue to sign in"}
        </Button>
      )}
      {invalidHandoff ? (
        <p role="alert" className="text-center text-sm text-[rgb(var(--fg-danger-text))]">
          Reopen your Skitza invitation email to continue.
        </p>
      ) : null}
      {failed ? (
        <p role="alert" className="text-center text-sm text-[rgb(var(--fg-danger-text))]">
          We couldn&apos;t open sign in. Try again.
        </p>
      ) : null}
    </div>
  );
}
