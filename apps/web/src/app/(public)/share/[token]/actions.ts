"use server";

import { TRPCError } from "@trpc/server";
import { ZodError } from "zod";
import { appRouter } from "~/server/trpc/routers/_app";

export type ActionResult = { ok: true } | { ok: false; error: string };

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
      case "NOT_FOUND":
        return "This project link isn't valid — ask your producer to resend it.";
      case "TOO_MANY_REQUESTS":
        return "Too many tries in a row. Wait a few seconds and try again.";
      case "BAD_REQUEST":
      case "PRECONDITION_FAILED":
        // Forward the specific message — these are usually direct
        // explanations of *why* the action failed (e.g. "No saved
        // payment method on file yet ...") that the user can act on.
        return err.message || "Check the form and try again.";
      default:
        return "Something broke on our end. Try again in a moment.";
    }
  }
  return err instanceof Error ? err.message : "Something broke on our end. Try again in a moment.";
}

export async function submitArtistComment(input: {
  token: string;
  versionId: string;
  authorName: string;
  authorEmail: string;
  body: string;
  timestampMs: number;
}): Promise<ActionResult> {
  try {
    const caller = appRouter.createCaller({ userId: null });
    await caller.project.publicComment(input);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: toMessage(err) };
  }
}

// Task 10 — server action wrapping the public Stripe Portal mutation.
// We expose this as a server action (not a tRPC client call) because
// the share-page is a server component and the rest of the page-client
// boundary in this folder uses the same actions.ts shim. Returns the
// URL on success so the client-side banner can `window.location.href`
// to it; surfaces a friendly error message otherwise.
export type PortalResult =
  | { ok: true; url: string }
  | { ok: false; error: string };

export async function requestCustomerPortal(input: {
  projectId: string;
  shareToken: string;
}): Promise<PortalResult> {
  try {
    const caller = appRouter.createCaller({ userId: null });
    const { url } = await caller.stripe.createCustomerPortalSession(input);
    return { ok: true, url };
  } catch (err) {
    return { ok: false, error: toMessage(err) };
  }
}
