"use server";

import { revalidatePath } from "next/cache";
import { TRPCError } from "@trpc/server";
import { ZodError } from "zod";
import { appRouter } from "~/server/trpc/routers/_app";
import { auth } from "@clerk/nextjs/server";

export type ActionResult = { ok: true } | { ok: false; error: string };

const PORTFOLIO_PATH = "/dashboard/portfolio";

// The (app) layout already gates auth, but Server Actions are exposed as
// independent endpoints — re-derive userId here rather than trust the page.
async function callerOrError(): Promise<
  | { ok: true; caller: ReturnType<typeof appRouter.createCaller> }
  | { ok: false; error: string }
> {
  const { userId } = await auth();
  if (!userId) return { ok: false, error: "Please sign in to continue." };
  return { ok: true, caller: appRouter.createCaller({ userId }) };
}

// Map tRPC / Zod failures to short, user-facing strings. The form renders
// these inline; throwing would surface a generic Next.js error overlay.
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
      case "FORBIDDEN":
        return "You don't have access to this track.";
      case "NOT_FOUND":
        return "Track not found.";
      case "BAD_REQUEST":
        return err.message || "Invalid input.";
      default:
        return "Something went wrong. Please try again.";
    }
  }
  return err instanceof Error ? err.message : "Something went wrong.";
}

export async function createTrack(input: {
  title: string;
  artist?: string;
  // Nullable: "create row first, upload into it" flow. Current UI still
  // passes a URL string (TODO A.8.1: wire AudioUploader into portfolio).
  audioUrl: string | null;
  artworkUrl?: string;
}): Promise<ActionResult> {
  const c = await callerOrError();
  if (!c.ok) return c;
  try {
    await c.caller.portfolio.create(input);
    revalidatePath(PORTFOLIO_PATH);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: toMessage(err) };
  }
}

export async function updateTrack(input: {
  id: string;
  title?: string;
  artist?: string;
  audioUrl?: string | null;
  artworkUrl?: string;
}): Promise<ActionResult> {
  const c = await callerOrError();
  if (!c.ok) return c;
  try {
    await c.caller.portfolio.update(input);
    revalidatePath(PORTFOLIO_PATH);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: toMessage(err) };
  }
}

export async function deleteTrack(input: { id: string }): Promise<ActionResult> {
  const c = await callerOrError();
  if (!c.ok) return c;
  try {
    await c.caller.portfolio.delete(input);
    revalidatePath(PORTFOLIO_PATH);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: toMessage(err) };
  }
}

// Reorder: accepts the full desired sequence of track IDs. The router's
// reorder procedure (portfolio.reorder) filters by producerId on every
// row update, so an alien id slipped into the list is a silent no-op
// (not a cross-tenant leak). The happy path assigns positions in order.
export async function reorderTracks(input: { orderedIds: string[] }): Promise<ActionResult> {
  const c = await callerOrError();
  if (!c.ok) return c;
  try {
    await c.caller.portfolio.reorder(input);
    revalidatePath(PORTFOLIO_PATH);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: toMessage(err) };
  }
}
