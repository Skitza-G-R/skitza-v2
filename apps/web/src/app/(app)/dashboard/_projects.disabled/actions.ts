"use server";

import { revalidatePath } from "next/cache";
import { TRPCError } from "@trpc/server";
import { ZodError } from "zod";
import { auth } from "@clerk/nextjs/server";

import { appRouter } from "~/server/trpc/routers/_app";

export type ActionResult = { ok: true } | { ok: false; error: string };
export type ActionDataResult<T> = { ok: true; data: T } | { ok: false; error: string };

const PATH_LIST = "/dashboard/projects";
function pathDetail(id: string): string {
  return `/dashboard/projects/${id}`;
}

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
      case "FORBIDDEN":
        return "You don't have access.";
      case "NOT_FOUND":
        return "Not found.";
      case "BAD_REQUEST":
        return err.message || "Invalid input.";
      default:
        return "Something went wrong. Please try again.";
    }
  }
  return err instanceof Error ? err.message : "Something went wrong.";
}

export async function createProject(input: {
  title: string;
  artistName: string;
  artistEmail: string;
  bookingId?: string;
}): Promise<ActionDataResult<{ id: string; shareToken: string }>> {
  const c = await callerOrError();
  if (!c.ok) return c;
  try {
    const res = await c.caller.project.create(input);
    revalidatePath(PATH_LIST);
    return { ok: true, data: { id: res.project.id, shareToken: res.shareToken } };
  } catch (err) {
    return { ok: false, error: toMessage(err) };
  }
}

export async function addTrack(input: {
  projectId: string;
  title: string;
  artist?: string;
}): Promise<ActionResult> {
  const c = await callerOrError();
  if (!c.ok) return c;
  try {
    await c.caller.project.addTrack(input);
    revalidatePath(pathDetail(input.projectId));
    return { ok: true };
  } catch (err) {
    return { ok: false, error: toMessage(err) };
  }
}

export async function addVersion(input: {
  projectId: string;
  trackId: string;
  label: string;
  // Nullable: "create row first, upload into it" flow passes null and
  // the AudioUploader fills audioUrl via audio.completeMultipart.
  audioUrl: string | null;
}): Promise<ActionDataResult<{ id: string }>> {
  const c = await callerOrError();
  if (!c.ok) return c;
  try {
    const row = await c.caller.project.addVersion({
      trackId: input.trackId,
      label: input.label,
      audioUrl: input.audioUrl,
    });
    revalidatePath(pathDetail(input.projectId));
    return { ok: true, data: { id: row.id } };
  } catch (err) {
    return { ok: false, error: toMessage(err) };
  }
}

export async function setPaid(input: {
  projectId: string;
  kind: "deposit" | "final";
  value: boolean;
}): Promise<ActionResult> {
  const c = await callerOrError();
  if (!c.ok) return c;
  try {
    await c.caller.project.setPaid(input);
    revalidatePath(pathDetail(input.projectId));
    return { ok: true };
  } catch (err) {
    return { ok: false, error: toMessage(err) };
  }
}

export async function resolveComment(input: {
  projectId: string;
  id: string;
  resolved: boolean;
}): Promise<ActionResult> {
  const c = await callerOrError();
  if (!c.ok) return c;
  try {
    await c.caller.project.resolveComment({ id: input.id, resolved: input.resolved });
    revalidatePath(pathDetail(input.projectId));
    return { ok: true };
  } catch (err) {
    return { ok: false, error: toMessage(err) };
  }
}

export async function postProducerReply(input: {
  projectId: string;
  versionId: string;
  body: string;
  timestampMs: number;
}): Promise<ActionResult> {
  const c = await callerOrError();
  if (!c.ok) return c;
  try {
    await c.caller.project.addProducerComment({
      versionId: input.versionId,
      body: input.body,
      timestampMs: input.timestampMs,
    });
    revalidatePath(pathDetail(input.projectId));
    return { ok: true };
  } catch (err) {
    return { ok: false, error: toMessage(err) };
  }
}
