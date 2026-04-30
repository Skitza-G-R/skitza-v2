"use server";

import { revalidatePath } from "next/cache";
import { TRPCError } from "@trpc/server";
import { ZodError } from "zod";
import { auth } from "@clerk/nextjs/server";

import { appRouter } from "~/server/trpc/routers/_app";

export type ActionResult = { ok: true } | { ok: false; error: string };

const PROFILE_PATH = "/dashboard/profile";

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

export async function addPortfolioFromLibrary(input: {
  title: string;
  artist: string | null;
  audioUrl: string;
}): Promise<ActionResult> {
  const c = await callerOrError();
  if (!c.ok) return c;
  try {
    await c.caller.portfolio.create({
      title: input.title,
      ...(input.artist ? { artist: input.artist } : {}),
      audioUrl: input.audioUrl,
    });
    revalidatePath(PROFILE_PATH);
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

export async function addExternalLink(input: {
  platform: ExternalPlatformValue;
  url: string;
  title: string | null;
}): Promise<ActionResult> {
  const c = await callerOrError();
  if (!c.ok) return c;
  try {
    await c.caller.producerExternalLinks.add({
      platform: input.platform,
      url: input.url,
      title: input.title,
    });
    revalidatePath(PROFILE_PATH);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: toMessage(err) };
  }
}

export async function removeExternalLink(input: {
  id: string;
}): Promise<ActionResult> {
  const c = await callerOrError();
  if (!c.ok) return c;
  try {
    await c.caller.producerExternalLinks.remove({ id: input.id });
    revalidatePath(PROFILE_PATH);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: toMessage(err) };
  }
}
