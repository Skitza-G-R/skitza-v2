"use server";

import { TRPCError } from "@trpc/server";
import { ZodError } from "zod";
import { auth } from "@clerk/nextjs/server";

import { appRouter } from "~/server/trpc/routers/_app";

type ActionData<T> = { ok: true; data: T } | { ok: false; error: string };

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
        return "You don't have access to this item.";
      case "NOT_FOUND":
        return "We couldn't find that item.";
      case "BAD_REQUEST":
        return err.message;
      default:
        return err.message || "Something went wrong.";
    }
  }
  if (err instanceof Error) return err.message;
  return "Something went wrong.";
}

async function caller() {
  const { userId } = await auth();
  if (!userId) throw new TRPCError({ code: "UNAUTHORIZED" });
  return appRouter.createCaller({ userId });
}

export async function initAudioUpload(input: {
  trackVersionId: string;
  filename: string;
  sizeBytes: number;
  contentType: string;
}): Promise<ActionData<{ uploadId: string; key: string }>> {
  try {
    const c = await caller();
    const data = await c.audio.initMultipart(input);
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: toMessage(err) };
  }
}

export async function signAudioPart(input: {
  key: string;
  uploadId: string;
  partNumber: number;
}): Promise<ActionData<{ url: string }>> {
  try {
    const c = await caller();
    const data = await c.audio.signPart(input);
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: toMessage(err) };
  }
}

export async function completeAudioUpload(input: {
  key: string;
  uploadId: string;
  parts: Array<{ partNumber: number; eTag: string }>;
  trackVersionId: string;
  sizeBytes: number;
  durationMs?: number;
}): Promise<ActionData<{ url: string; key: string }>> {
  try {
    const c = await caller();
    const data = await c.audio.completeMultipart(input);
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: toMessage(err) };
  }
}

export async function abortAudioUpload(input: {
  key: string;
  uploadId: string;
}): Promise<ActionData<{ ok: true }>> {
  try {
    const c = await caller();
    const data = await c.audio.abortMultipart(input);
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: toMessage(err) };
  }
}
