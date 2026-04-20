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
    if (input.slug) revalidatePath(`/p/${input.slug}`);
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
