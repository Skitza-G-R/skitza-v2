"use server";

import { TRPCError } from "@trpc/server";

import { appRouter } from "~/server/trpc/routers/_app";

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
  // Public funnel — no auth context. The procedure validates inputs
  // and reads x-forwarded-for via next/headers itself.
  const caller = appRouter.createCaller({ userId: null });

  try {
    await caller.waitlist.signup({
      email: input.email,
      firstName: input.firstName,
      locale: input.locale,
      utm: {
        source: input.utmSource,
        medium: input.utmMedium,
        campaign: input.utmCampaign,
      },
      referrer: input.referrer,
      company: input.company,
    });
    return { ok: true };
  } catch (err) {
    if (err instanceof TRPCError) {
      if (err.code === "TOO_MANY_REQUESTS") {
        return {
          ok: false,
          code: "RATE_LIMITED",
          message: err.message,
        };
      }
      if (err.code === "BAD_REQUEST") {
        return {
          ok: false,
          code: "VALIDATION",
          message: "Please enter a valid email address.",
        };
      }
      return {
        ok: false,
        code: "INTERNAL",
        message: err.message,
      };
    }
    // Zod errors raised before the procedure body — surface a friendly
    // generic message and let server logs hold the detail.
    return {
      ok: false,
      code: "VALIDATION",
      message: "Please enter a valid email address.",
    };
  }
}
