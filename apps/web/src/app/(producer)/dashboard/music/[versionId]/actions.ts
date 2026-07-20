"use server";

import { auth } from "@clerk/nextjs/server";
import { TRPCError } from "@trpc/server";
import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { ZodError } from "zod";

import { appRouter } from "~/server/trpc/routers/_app";

// Server actions used by the L3 song page. Thin wrappers over the
// existing project tRPC mutations (resolveComment, addProducerComment,
// exact producer readiness and reopen). Same shape as the actions in
// (producer)/dashboard/clients-projects/actions.ts — duplicated rather
// than imported so the L3 page doesn't take a dependency on a sibling
// route group's action file (cross-route imports tend to drift). Each
// action revalidates the L3 path so optimistic updates flush back to
// the canonical server-rendered state on next navigation.

export type MusicL3ActionResult = { ok: true } | { ok: false; error: string };

function pathDetail(versionId: string): string {
  return `/dashboard/music/${versionId}`;
}

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
      case "FORBIDDEN":
        return "You don't have access.";
      case "NOT_FOUND":
        return "Not found.";
      case "BAD_REQUEST":
      case "PRECONDITION_FAILED":
      case "CONFLICT":
        return err.message || "Invalid input.";
      default:
        return "Something went wrong. Please try again.";
    }
  }
  return err instanceof Error ? err.message : "Something went wrong.";
}

export async function l3AddComment(input: {
  versionId: string;
  body: string;
  timestampMs: number;
}): Promise<MusicL3ActionResult> {
  const c = await callerOrError();
  if (!c.ok) return c;
  try {
    await c.caller.project.addProducerComment({
      versionId: input.versionId,
      body: input.body,
      timestampMs: input.timestampMs,
    });
    revalidatePath(pathDetail(input.versionId));
    return { ok: true };
  } catch (err) {
    return { ok: false, error: toMessage(err) };
  }
}

export async function l3ResolveComment(input: {
  versionId: string;
  id: string;
  resolved: boolean;
}): Promise<MusicL3ActionResult> {
  const c = await callerOrError();
  if (!c.ok) return c;
  try {
    await c.caller.project.resolveComment({ id: input.id, resolved: input.resolved });
    revalidatePath(pathDetail(input.versionId));
    return { ok: true };
  } catch (err) {
    return { ok: false, error: toMessage(err) };
  }
}

export async function l3MarkVersionReady(input: {
  versionId: string;
  ready: boolean;
}): Promise<MusicL3ActionResult> {
  const c = await callerOrError();
  if (!c.ok) return c;
  try {
    await c.caller.project.markVersionReady({
      versionId: input.versionId,
      ready: input.ready,
    });
    revalidatePath(pathDetail(input.versionId));
    return { ok: true };
  } catch (err) {
    return { ok: false, error: toMessage(err) };
  }
}

export async function l3ReopenApprovedSong(input: {
  trackId: string;
  versionId: string;
}): Promise<MusicL3ActionResult> {
  const c = await callerOrError();
  if (!c.ok) return c;
  try {
    await c.caller.project.reopenApprovedSong({ trackId: input.trackId });
    revalidatePath(pathDetail(input.versionId));
    return { ok: true };
  } catch (err) {
    return { ok: false, error: toMessage(err) };
  }
}

export async function l3SetDownloadOverride(input: {
  purchaseId: string;
  versionId: string;
  enabled: boolean;
  expectedUnpaidAmountCents: number;
}): Promise<MusicL3ActionResult> {
  const c = await callerOrError();
  if (!c.ok) return c;
  try {
    await c.caller.audioDelivery.setDownloadOverride({
      purchaseId: input.purchaseId,
      versionId: input.versionId,
      enabled: input.enabled,
      expectedUnpaidAmountCents: input.expectedUnpaidAmountCents,
      operationKey: `music-delivery:${randomUUID()}`,
    });
    revalidatePath(pathDetail(input.versionId));
    revalidatePath(`/artist/music/song/${input.versionId}`);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: toMessage(err) };
  }
}
