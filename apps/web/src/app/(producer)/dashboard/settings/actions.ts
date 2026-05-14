"use server";

import { revalidatePath } from "next/cache";
import { TRPCError } from "@trpc/server";
import { ZodError } from "zod";
import { auth } from "@clerk/nextjs/server";

import { appRouter } from "~/server/trpc/routers/_app";

export type ActionResult = { ok: true } | { ok: false; error: string };

// Revalidate both the settings page (so the form rehydrates with the
// new values) and every page that reads the producer's slug/display
// name, so changes take effect immediately.
const SETTINGS_PATH = "/dashboard/settings";

async function callerOrError(): Promise<
  | { ok: true; caller: ReturnType<typeof appRouter.createCaller> }
  | { ok: false; error: string }
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
  // Settings redesign — calendar week orientation. UI flips between
  // Sunday-first ('sun') and Monday-first ('mon').
  weekStart?: "sun" | "mon";
  // Settings redesign — per-event notification preferences. Partial
  // map: keys not in the patch keep their existing values server-side.
  notificationPrefs?: Record<string, { email: boolean; app: boolean }>;
}): Promise<ActionResult> {
  const c = await callerOrError();
  if (!c.ok) return c;
  try {
    await c.caller.producer.update(input);
    // Revalidate every surface that might display the producer's
    // display name, slug, or brand — these are scattered across
    // dashboard, portfolio, leads, and the public page.
    revalidatePath(SETTINGS_PATH);
    revalidatePath("/dashboard");
    revalidatePath("/dashboard/portfolio");
    revalidatePath("/dashboard/leads");
    // Post-Story-03: slug changes invalidate the /join/<slug> teaser.
    if (input.slug) revalidatePath(`/join/${input.slug}`);
    return { ok: true };
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

// Producer requests a Tranzila terminal connection. The mutation logs
// the request server-side; a Skitza admin watches the logs, provisions
// a terminal at Tranzila, and writes the terminal name onto the
// producer row out-of-band. The page revalidates so the next render
// reflects the connected state without a manual refresh once admin
// has provisioned.
export async function requestPaymentConnection(input: {
  businessName: string;
  contactEmail: string;
  phone: string;
}): Promise<ActionResult> {
  const c = await callerOrError();
  if (!c.ok) return c;
  try {
    await c.caller.producer.requestPaymentConnection(input);
    revalidatePath(SETTINGS_PATH);
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
