"use server";

import { revalidatePath } from "next/cache";
import { TRPCError } from "@trpc/server";
import { ZodError } from "zod";
import { auth } from "~/server/auth/clerk-identity";

import { appRouter } from "~/server/trpc/routers/_app";

export type ActionResult = { ok: true } | { ok: false; error: string };

const PORTFOLIO_PATH = "/dashboard/portfolio";

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
        return "Not found.";
      case "FORBIDDEN":
        return "You don't have access to that.";
      case "BAD_REQUEST":
        return err.message || "Invalid input.";
      default:
        return "Something went wrong. Please try again.";
    }
  }
  return err instanceof Error ? err.message : "Something went wrong.";
}

export async function setPortfolioSongPublished(input: {
  trackId: string;
  operationKey: string;
  published: boolean;
}): Promise<ActionResult> {
  const c = await callerOrError();
  if (!c.ok) return c;
  try {
    await c.caller.songPublication.setPortfolioPublic(input);
    revalidatePath(PORTFOLIO_PATH);
    revalidatePath("/join/[slug]", "page");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: toMessage(err) };
  }
}

export type ExternalPlatformValue =
  | "spotify"
  | "apple_music"
  | "youtube"
  | "soundcloud"
  | "bandcamp"
  | "tidal"
  | "instagram_reels";

// Smart-paste add: the server detects the platform from the URL itself
// (see ~/lib/external-links/detect-platform).
export async function addExternalLink(input: { url: string }): Promise<ActionResult> {
  const c = await callerOrError();
  if (!c.ok) return c;
  try {
    await c.caller.producerExternalLinks.add({ url: input.url });
    revalidatePath(PORTFOLIO_PATH);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: toMessage(err) };
  }
}

// Bulk-reorder the producer's external links. UI sends the new full
// order (typically the result of an adjacent-swap from ▲/▼ click); the
// existing producerExternalLinks.reorder mutation maps each id → its
// index inside one Promise.all, scoped by producer.
export async function reorderExternalLinks(input: { orderedIds: string[] }): Promise<ActionResult> {
  const c = await callerOrError();
  if (!c.ok) return c;
  try {
    await c.caller.producerExternalLinks.reorder({
      orderedIds: input.orderedIds,
    });
    revalidatePath(PORTFOLIO_PATH);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: toMessage(err) };
  }
}

export async function removeExternalLink(input: { id: string }): Promise<ActionResult> {
  const c = await callerOrError();
  if (!c.ok) return c;
  try {
    await c.caller.producerExternalLinks.remove({ id: input.id });
    revalidatePath(PORTFOLIO_PATH);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: toMessage(err) };
  }
}
