import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { headers } from "next/headers";

import { publicProcedure, router } from "../init";
import { checkRateLimit } from "~/lib/rate-limit/in-memory";

// Waitlist signup for the /get-started ad funnel. Posts directly to
// a Make.com webhook (configured in Vercel env), which routes to
// Airtable + any optional fan-outs. No DB writes here — the funnel
// is intentionally low-coupling so we can change the downstream
// pipeline without touching the app.
//
// Honeypot: bots autofill `company`. Humans never see the field
// (it's `display:none` in the form). Non-empty `company` returns
// silent success — the bot doesn't learn it was blocked, so it
// won't retry with a different signature.
//
// Rate-limit: 5 signups / IP / hour. The in-memory limiter is
// per-container on Vercel; that's acceptable because legitimate
// users will not hit 5/hour from a single IP and an attacker spawning
// many cold containers is a separate problem.

const SignupInput = z
  .object({
    email: z.string().trim().toLowerCase().email().max(254),
    firstName: z.string().trim().min(1).max(60).optional(),
    locale: z.enum(["en", "he"]),
    utm: z
      .object({
        source: z.string().max(50).optional(),
        medium: z.string().max(50).optional(),
        campaign: z.string().max(100).optional(),
      })
      .optional(),
    referrer: z.string().url().max(2048).optional(),
    // Honeypot — must remain a string OR be omitted. Bots will
    // happily fill it; the procedure body short-circuits on a
    // non-empty value. Length cap prevents memory abuse on the
    // body parser if a bot sends MB of garbage. Note we DON'T use
    // max(0) — that would reject the input at validation and the
    // bot would learn it failed.
    company: z.string().max(120).optional(),
  })
  .strict();

const WEBHOOK_TIMEOUT_MS = 10_000;

export const waitlistRouter = router({
  signup: publicProcedure
    .input(SignupInput)
    .mutation(async ({ input }) => {
      // Honeypot — silent success so bots can't learn they were blocked
      if (input.company && input.company.length > 0) {
        return { status: "ok" as const };
      }

      const hdrs = await headers();
      const ip =
        hdrs.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
      const userAgent = hdrs.get("user-agent") ?? null;

      // 5 signups / IP / hour. See file header for rationale.
      const rl = checkRateLimit(`waitlist:${ip}`, 5, 3_600_000);
      if (!rl.ok) {
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message: "Too many signups from this address. Try again later.",
        });
      }

      const webhookUrl = process.env.MAKE_WAITLIST_WEBHOOK_URL;
      if (!webhookUrl) {
        // Logged but the user-facing message stays generic — no infra
        // detail leaked to the public.
        console.error("[waitlist] MAKE_WAITLIST_WEBHOOK_URL not configured");
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Signup is temporarily unavailable.",
        });
      }

      const payload = {
        email: input.email,
        firstName: input.firstName ?? null,
        locale: input.locale,
        utmSource: input.utm?.source ?? null,
        utmMedium: input.utm?.medium ?? null,
        utmCampaign: input.utm?.campaign ?? null,
        referrer: input.referrer ?? null,
        userAgent,
        ipAddress: ip,
        signedUpAt: new Date().toISOString(),
      };

      const controller = new AbortController();
      const timer = setTimeout(() => {
        controller.abort();
      }, WEBHOOK_TIMEOUT_MS);

      try {
        const response = await fetch(webhookUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
          signal: controller.signal,
        });

        if (!response.ok) {
          console.error(
            `[waitlist] Webhook returned ${String(response.status)}`,
          );
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Could not save your signup. Please try again.",
          });
        }
      } catch (err: unknown) {
        if (err instanceof TRPCError) throw err;
        console.error("[waitlist] Webhook fetch failed", err);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Could not save your signup. Please try again.",
        });
      } finally {
        clearTimeout(timer);
      }

      return { status: "ok" as const };
    }),
});
