"use client";

import { useEffect } from "react";

export const INVITATION_SIGNUP_HANDOFF_KEY = "skitza:invitation-signup-handoff";

export function InvitationSignupMarker({ handoffToken }: { handoffToken: string }) {
  useEffect(() => {
    window.sessionStorage.setItem(INVITATION_SIGNUP_HANDOFF_KEY, handoffToken);
  }, [handoffToken]);

  return null;
}
