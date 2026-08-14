"use server";

// Server action wrapping waitlist.signup. The /get-started client form
// calls this via React's `useTransition` rather than wiring up
// @trpc/react-query — matches the pattern across the producer
// dashboard (`quick-note-actions.ts`, `audio-upload-actions.ts`,
// etc.) and avoids polluting the dead-end-funnel layout with a
// global tRPC provider.
//
// Returns a discriminated union the client can branch on without
// re-throwing — keeps error UX in the form's render path.

export type WaitlistInput = {
  email: string;
  firstName?: string;
  locale: "en" | "he";
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  referrer?: string;
  company?: string;
};

export type WaitlistResult =
  | { ok: true }
  | { ok: false; code: "RATE_LIMITED" | "INTERNAL" | "VALIDATION"; message: string };

export async function submitWaitlist(input: WaitlistInput): Promise<WaitlistResult> {
  await Promise.resolve();
  void input;
  return {
    ok: false,
    code: "INTERNAL",
    message: "This signup list is no longer available.",
  };
}
