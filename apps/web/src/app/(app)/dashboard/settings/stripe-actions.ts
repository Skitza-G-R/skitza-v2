"use server";

import { revalidatePath } from "next/cache";
import { TRPCError } from "@trpc/server";
import { auth } from "@clerk/nextjs/server";

import { appRouter } from "~/server/trpc/routers/_app";

export type StripeUrlResult = { ok: true; url: string } | { ok: false; error: string };
export type StripeRefreshResult =
  | { ok: true; chargesEnabled: boolean }
  | { ok: false; error: string };

function toMessage(err: unknown): string {
  if (err instanceof TRPCError) {
    if (err.code === "UNAUTHORIZED") return "Please sign in to continue.";
    return err.message || "Stripe call failed — try again.";
  }
  if (err instanceof Error && /STRIPE_SECRET_KEY/.test(err.message)) {
    return "Stripe is not configured on this server. Set STRIPE_SECRET_KEY.";
  }
  return err instanceof Error ? err.message : "Something went wrong.";
}

// Kicks the producer through Stripe Connect's hosted onboarding. The
// returned URL is a single-use, time-limited Stripe-side link; the
// client redirects with `window.location.href = url` rather than a
// Next.js navigation so the third-party cookie/referer dance works.
export async function startStripeOnboarding(): Promise<StripeUrlResult> {
  const { userId } = await auth();
  if (!userId) return { ok: false, error: "Please sign in to continue." };
  try {
    const caller = appRouter.createCaller({ userId });
    const { url } = await caller.stripe.createOnboardingLink();
    return { ok: true, url };
  } catch (err) {
    return { ok: false, error: toMessage(err) };
  }
}

// Hard refresh of `charges_enabled` from Stripe. Called from the
// settings page on `?stripe=return` so the badge flips before the
// webhook lands.
export async function refreshStripeStatus(): Promise<StripeRefreshResult> {
  const { userId } = await auth();
  if (!userId) return { ok: false, error: "Please sign in to continue." };
  try {
    const caller = appRouter.createCaller({ userId });
    const { chargesEnabled } = await caller.stripe.refreshAccount();
    revalidatePath("/dashboard/settings");
    return { ok: true, chargesEnabled };
  } catch (err) {
    return { ok: false, error: toMessage(err) };
  }
}

// Mints a Stripe Express dashboard link. The producer follows it to
// see payouts, refunds, and disputes.
export async function openStripeDashboard(): Promise<StripeUrlResult> {
  const { userId } = await auth();
  if (!userId) return { ok: false, error: "Please sign in to continue." };
  try {
    const caller = appRouter.createCaller({ userId });
    const { url } = await caller.stripe.createDashboardLink();
    if (!url) return { ok: false, error: "Connect Stripe first." };
    return { ok: true, url };
  } catch (err) {
    return { ok: false, error: toMessage(err) };
  }
}
