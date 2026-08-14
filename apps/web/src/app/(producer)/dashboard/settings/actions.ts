"use server";

import { revalidatePath } from "next/cache";
import { TRPCError } from "@trpc/server";
import { ZodError } from "zod";
import { auth } from "~/server/auth/clerk-identity";

import { appRouter } from "~/server/trpc/routers/_app";

export type ActionResult =
  | { ok: true }
  | {
      ok: false;
      error: string;
      saved?: {
        producer: boolean;
        paymentInstructions: boolean;
      };
    };

// Revalidate both the settings page (so the form rehydrates with the
// new values) and every page that reads the producer's slug/display
// name, so changes take effect immediately.
const SETTINGS_PATH = "/dashboard/settings";

async function callerOrError(): Promise<
  { ok: true; caller: ReturnType<typeof appRouter.createCaller> } | { ok: false; error: string }
> {
  const { userId } = await auth();
  if (!userId) return { ok: false, error: "Please sign in to continue." };
  return { ok: true, caller: appRouter.createCaller({ userId }) };
}

function toMessage(err: unknown): string {
  if (err instanceof ZodError) {
    const first = err.issues[0];
    if (first) {
      const field = first.path.join(".");
      return field ? `${field}: ${first.message}` : first.message;
    }
    return "Invalid input.";
  }
  if (err instanceof TRPCError) {
    switch (err.code) {
      case "UNAUTHORIZED":
        return "Please sign in to continue.";
      case "NOT_FOUND":
        return "Profile not found.";
      case "BAD_REQUEST":
        return err.message || "Invalid input.";
      default:
        return "Something went wrong. Please try again.";
    }
  }
  return err instanceof Error ? err.message : "Something went wrong.";
}

export async function updateProducer(input: {
  displayName?: string;
  slug?: string;
  defaultCurrency?: "USD" | "EUR" | "GBP" | "ILS";
  timezone?: string;
  brand?: {
    primary?: string;
    accent?: string;
    logoUrl?: string;
  };
  // Calendar week orientation. UI flips between Sunday-first ('sunday')
  // and Monday-first ('monday'). Long form matches the producers.week_start
  // column shape and the useWeekStartPref hook in lib/time/week-start.ts.
  weekStart?: "sunday" | "monday";
  // Settings redesign — per-event notification preferences. Partial
  // map: keys not in the patch keep their existing values server-side.
  notificationPrefs?: Record<string, { email: boolean; app: boolean }>;
  // Migration 0019 — business-level tax disclosure mode + rate.
  // 'tax_added' adds the configured rate to a commercial total; the other
  // two modes are display-only. See ~/lib/tax-mode for helpers.
  taxMode?: "tax_free" | "tax_included" | "tax_added";
  taxRatePct?: number;
  paymentInstructions?: {
    bankTransfer?: string;
    bitPhone?: string;
    note?: string;
  };
}): Promise<ActionResult> {
  const c = await callerOrError();
  if (!c.ok) return c;
  try {
    const { paymentInstructions, ...producerInput } = input;
    const producerRequested = Object.keys(producerInput).length > 0;
    const paymentInstructionsRequested = paymentInstructions !== undefined;
    const [producerResult, paymentInstructionsResult] = await Promise.allSettled([
      producerRequested ? c.caller.producer.update(producerInput) : Promise.resolve(),
      paymentInstructionsRequested
        ? c.caller.producer.purchase.paymentInstructions.update(paymentInstructions)
        : Promise.resolve(),
    ]);
    const producerSaved = producerRequested && producerResult.status === "fulfilled";
    const paymentInstructionsSaved =
      paymentInstructionsRequested && paymentInstructionsResult.status === "fulfilled";

    // Revalidate every surface that might display the producer's
    // display name, slug, or brand — these are scattered across
    // dashboard, portfolio, leads, and the public page.
    if (producerSaved || paymentInstructionsSaved) {
      revalidatePath(SETTINGS_PATH);
    }
    if (producerSaved) {
      revalidatePath("/dashboard");
      revalidatePath("/dashboard/portfolio");
      revalidatePath("/dashboard/leads");
    }
    // weekStart is read server-side by the Calendar (availability tab)
    // and the onboarding availability step; both need to see the new
    // value on next visit. Bust both even when only weekStart changes.
    if (producerSaved && input.weekStart) {
      revalidatePath("/dashboard/calendar");
      revalidatePath("/onboarding/availability");
    }
    // Post-Story-03: slug changes invalidate the /join/<slug> teaser.
    if (producerSaved && input.slug) revalidatePath(`/join/${input.slug}`);
    // Migration 0019 — tax mode + rate changes invalidate every
    // artist surface that renders prices AND the producer's own
    // storefront view (which shows the inline picker chip).
    if (producerSaved && (input.taxMode !== undefined || input.taxRatePct !== undefined)) {
      revalidatePath("/dashboard/profile");
      revalidatePath("/dashboard/store");
      revalidatePath("/artist/store", "layout");
      revalidatePath("/join", "layout");
    }
    if (paymentInstructionsSaved) {
      revalidatePath("/artist", "layout");
    }

    const producerSucceeded = !producerRequested || producerResult.status === "fulfilled";
    const paymentInstructionsSucceeded =
      !paymentInstructionsRequested || paymentInstructionsResult.status === "fulfilled";
    if (producerSucceeded && paymentInstructionsSucceeded) return { ok: true };

    const failureReason: unknown =
      producerResult.status === "rejected"
        ? producerResult.reason
        : paymentInstructionsResult.status === "rejected"
          ? paymentInstructionsResult.reason
          : new Error("Settings were not saved");
    const savedMessage = paymentInstructionsSaved
      ? "Payment instructions were saved; your other changes were not."
      : producerSaved
        ? "Your other settings were saved; payment instructions were not."
        : "";
    return {
      ok: false,
      error: [toMessage(failureReason), savedMessage].filter(Boolean).join(" "),
      saved: {
        producer: producerSaved,
        paymentInstructions: paymentInstructionsSaved,
      },
    };
  } catch (err) {
    return { ok: false, error: toMessage(err) };
  }
}

// Batch G — Autopilot toggle flip. One named behavior at a time; the
// `key` enum is enforced at the tRPC input layer so unknown keys
// never reach the DB. Revalidates the Setup page so the server-
// rendered switch state matches DB truth on the next request.
export async function updateAutopilot(input: {
  key: "welcomeEmail" | "unpaidReminder" | "requestTestimonial" | "commentNotify" | "autoArchive";
  enabled: boolean;
}): Promise<ActionResult> {
  const c = await callerOrError();
  if (!c.ok) return c;
  try {
    await c.caller.producer.updateAutopilot(input);
    revalidatePath(SETTINGS_PATH);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: toMessage(err) };
  }
}

// Marketing meta editor (Settings → Profile branch). Curated freeform
// strings that surface on the public /join/<slug> page's 4-stat band
// (Genres / Released / Streams / Response). Each field is independently
// nullable so the producer can clear a single stat without affecting
// the others. Revalidates the Settings page (so the form rehydrates)
// AND the public /join page so the strip reflects the new copy
// immediately.
export async function updateMarketing(input: {
  genres?: string[] | null;
  releasedSummary?: string | null;
  streamsSummary?: string | null;
  responseHours?: 24 | 48 | 168 | null;
}): Promise<ActionResult> {
  const c = await callerOrError();
  if (!c.ok) return c;
  try {
    await c.caller.producer.updateMarketing(input);
    revalidatePath(SETTINGS_PATH);
    // Bust the public /join page cache. We don't have the slug here
    // without an extra round-trip, so revalidate the route group as a
    // tag-less fallback. For now revalidate the section root; the
    // settings page revalidation also covers the producer's own
    // dashboard surfaces. The /join slug-specific page is statically
    // rendered so a producer save → next visitor read sees fresh copy
    // within the standard ISR window.
    revalidatePath("/join", "layout");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: toMessage(err) };
  }
}

// Story 01 of /join flow — per-track public-sample flip. The tRPC
// layer does the owner check and collapses "not yours" and "not
// found" into the same NOT_FOUND (enumeration-proof, see
// portfolio.ts togglePublicSample). Revalidates Setup so the server
// component re-fetches the updated flag on the next navigation.
export async function togglePublicSample(input: {
  trackId: string;
  enabled: boolean;
}): Promise<ActionResult> {
  const c = await callerOrError();
  if (!c.ok) return c;
  try {
    await c.caller.portfolio.togglePublicSample(input);
    revalidatePath(SETTINGS_PATH);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: toMessage(err) };
  }
}
