"use server";

import { auth } from "~/server/auth/clerk-identity";
import { TRPCError } from "@trpc/server";

import { appRouter } from "~/server/trpc/routers/_app";
import { toSafeUploadStageError } from "~/server/audio/upload-action-errors";

type ActionData<T> = { ok: true; data: T } | { ok: false; error: string };

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
}): Promise<ActionData<{ uploadId: string; key: string; completionToken: string }>> {
  try {
    const c = await caller();
    const data = await c.audio.initMultipart(input);
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: toSafeUploadStageError("initiation", err) };
  }
}

export async function signAudioPart(input: {
  key: string;
  uploadId: string;
  partNumber: number;
  trackVersionId: string;
}): Promise<ActionData<{ url: string }>> {
  try {
    const c = await caller();
    const data = await c.audio.signPart(input);
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: toSafeUploadStageError("presign", err) };
  }
}

export async function completeAudioUpload(input: {
  key: string;
  uploadId: string;
  parts: Array<{ partNumber: number; eTag: string }>;
  trackVersionId: string;
  sizeBytes: number;
  completionToken: string;
  acknowledgePublicExposure: boolean;
  durationMs?: number;
}): Promise<ActionData<{ url: string; key: string }>> {
  try {
    const c = await caller();
    const data = await c.audio.completeMultipart(input);
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: toSafeUploadStageError("completion", err) };
  }
}

export async function abortAudioUpload(input: {
  key: string;
  uploadId: string;
  trackVersionId: string;
  sizeBytes: number;
  completionToken: string;
}): Promise<ActionData<{ ok: true }>> {
  try {
    const c = await caller();
    const data = await c.audio.abortMultipart(input);
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: toSafeUploadStageError("cancellation", err) };
  }
}
