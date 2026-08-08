"use server";

import { revalidatePath } from "next/cache";
import { TRPCError } from "@trpc/server";
import { ZodError } from "zod";
import { auth } from "@clerk/nextjs/server";

import { appRouter } from "~/server/trpc/routers/_app";
import type { WorkflowStage } from "~/lib/clients/workflow-stage";
import { toSafeUploadStageError } from "~/server/audio/upload-action-errors";

// ─── Result types ────────────────────────────────────────────────────
// Mirrors the convention in clients-actions.ts so the Upload Track
// modal can `if (!res.ok) throw new Error(res.error)` on any failure.
export type ActionResult = { ok: true } | { ok: false; error: string };
export type ActionDataResult<T> = { ok: true; data: T } | { ok: false; error: string };

export interface AudioStorageUsage {
  usedBytes: number;
  reservedBytes: number;
  committedBytes: number;
  availableBytes: number;
  limitBytes: number;
  warningBytes: number;
  isAtOrAboveWarning: boolean;
  isFull: boolean;
}

const CLIENTS_PROJECTS_PATH = "/dashboard/clients-projects";
const MUSIC_LIBRARY_PATH = "/dashboard/music";

async function callerOrError(): Promise<
  { ok: true; caller: ReturnType<typeof appRouter.createCaller> } | { ok: false; error: string }
> {
  const { userId } = await auth();
  if (!userId) return { ok: false, error: "Please sign in to continue." };
  return { ok: true, caller: appRouter.createCaller({ userId }) };
}

function toMessage(err: unknown): string {
  if (err instanceof TRPCError) {
    // I4 — tRPC wraps Zod errors inside TRPCError with code=BAD_REQUEST
    // and the original ZodError on `cause`. A bare `instanceof ZodError`
    // check above never matched because the error is already wrapped by
    // the time it reaches us. Unwrap the cause here so the user sees a
    // human message ("Version label is required") instead of the
    // serialised Zod issue dump.
    if (err.cause instanceof ZodError) {
      return err.cause.issues[0]?.message ?? "Invalid input.";
    }
    switch (err.code) {
      case "UNAUTHORIZED":
        return "Please sign in to continue.";
      case "NOT_FOUND":
        return "We couldn't find that track or project.";
      case "FORBIDDEN":
        return "You don't have access to that track.";
      case "BAD_REQUEST":
        return err.message || "Invalid input.";
      default:
        return err.message || "Something went wrong. Please try again.";
    }
  }
  return err instanceof Error ? err.message : "Something went wrong.";
}

export async function getAudioStorageUsageAction(): Promise<ActionDataResult<AudioStorageUsage>> {
  const c = await callerOrError();
  if (!c.ok) return c;
  try {
    const data = await c.caller.audio.storageUsage();
    return { ok: true, data };
  } catch (err) {
    console.error("[upload-actions]", err);
    return { ok: false, error: toMessage(err) };
  }
}

export async function reconcileAudioStorageUsageAction(): Promise<
  ActionDataResult<AudioStorageUsage>
> {
  const c = await callerOrError();
  if (!c.ok) return c;
  try {
    const data = await c.caller.audio.reconcileStorageUsage();
    return { ok: true, data };
  } catch (err) {
    console.error("[upload-actions]", err);
    return { ok: false, error: toMessage(err) };
  }
}

export type PreparedFirstVersionUpload =
  | {
      status: "completed";
      intentId: string;
      projectId: string;
      trackId: string;
      versionId: string;
    }
  | {
      status: "ready";
      intentId: string;
      projectId: string;
      trackId: string;
      versionId: string;
      uploadUrl: string;
      headers: Record<string, string>;
      expiresInSeconds: number;
    };

export async function prepareFirstVersionUploadAction(input: {
  operationKey: string;
  projectId: string;
  title: string;
  artist?: string | null;
  label: string;
  description?: string | null;
  filename: string;
  sizeBytes: number;
  contentType: string;
  durationMs?: number | null;
}): Promise<ActionDataResult<PreparedFirstVersionUpload>> {
  const c = await callerOrError();
  if (!c.ok) return c;
  try {
    const data = await c.caller.firstVersionUpload.prepare(input);
    return { ok: true, data };
  } catch (err) {
    console.error("[upload-actions]", err);
    return { ok: false, error: toSafeUploadStageError("initiation", err) };
  }
}

export async function completeFirstVersionUploadAction(input: {
  intentId: string;
}): Promise<
  ActionDataResult<{ projectId: string; trackId: string; versionId: string; url: string }>
> {
  const c = await callerOrError();
  if (!c.ok) return c;
  try {
    const data = await c.caller.firstVersionUpload.complete(input);
    revalidatePath(CLIENTS_PROJECTS_PATH);
    revalidatePath(`${CLIENTS_PROJECTS_PATH}/${data.projectId}`);
    revalidatePath(MUSIC_LIBRARY_PATH);
    return { ok: true, data };
  } catch (err) {
    console.error("[upload-actions]", err);
    return { ok: false, error: toSafeUploadStageError("completion", err) };
  }
}

export async function cancelFirstVersionUploadAction(input: {
  intentId: string;
}): Promise<ActionDataResult<{ ok: true; completed: boolean }>> {
  const c = await callerOrError();
  if (!c.ok) return c;
  try {
    const data = await c.caller.firstVersionUpload.cancel(input);
    return { ok: true, data };
  } catch (err) {
    console.error("[upload-actions]", err);
    return { ok: false, error: toSafeUploadStageError("cancellation", err) };
  }
}

// ─── Track + version creation ────────────────────────────────────────
// Compatibility bridge for the separate paid/no-charge commercial flows.
// File-first V1 uploads never call this action; they commit Song + V1 together.
export async function addTrackAction(input: {
  projectId: string;
  purchaseId: string;
  operationKey: string;
  title: string;
  artist?: string;
}): Promise<ActionDataResult<{ id: string; projectId: string; title: string }>> {
  const c = await callerOrError();
  if (!c.ok) return c;
  try {
    const row = await c.caller.project.addTrack(input);
    // Don't revalidate yet — the upload chain isn't done and an
    // intermediate refresh would flash a "no audio" row. The terminal
    // `completeMultipart` revalidates.
    return {
      ok: true,
      data: { id: row.id, projectId: row.projectId, title: row.title },
    };
  } catch (err) {
    console.error("[upload-actions]", err);
    return { ok: false, error: toMessage(err) };
  }
}

// Inserts a new track_versions row with audioUrl=null. The upload
// pipeline patches this row inside completeMultipart once R2 confirms.
//
// M2 — we intentionally do NOT revalidatePath here. addVersionAction
// fires at step 2 of the chain (row created with audioUrl=null); a
// mid-flight revalidate would flash a "no audio" row to the producer.
// The terminal completeMultipartAction (and abortMultipartAction on
// failure) revalidate once the row reaches a final state.
export async function addVersionAction(input: {
  trackId: string;
  label: string;
  audioUrl: null;
  durationMs?: number;
  description?: string;
}): Promise<ActionDataResult<{ id: string; trackId: string; label: string }>> {
  const c = await callerOrError();
  if (!c.ok) return c;
  try {
    const row = await c.caller.project.addVersion({
      trackId: input.trackId,
      label: input.label,
      audioUrl: input.audioUrl,
      ...(input.durationMs === undefined ? {} : { durationMs: input.durationMs }),
      ...(input.description === undefined ? {} : { description: input.description }),
    });
    return {
      ok: true,
      data: { id: row.id, trackId: row.trackId, label: row.label },
    };
  } catch (err) {
    console.error("[upload-actions]", err);
    return { ok: false, error: toSafeUploadStageError("initiation", err) };
  }
}

// Phase 4 (I1) — cleanup an orphan track_versions row created by
// addVersionAction when the rest of the upload chain failed. Fired
// from the modal's catch branch after the R2 multipart has been
// aborted. Best-effort — failures are silently swallowed by the
// caller, so the producer can still retry without seeing two error
// toasts in a row.
export async function deleteVersionAction(input: { id: string }): Promise<ActionResult> {
  const c = await callerOrError();
  if (!c.ok) return c;
  try {
    await c.caller.project.deleteVersion(input);
    revalidatePath(CLIENTS_PROJECTS_PATH);
    return { ok: true };
  } catch (err) {
    console.error("[upload-actions]", err);
    return { ok: false, error: toMessage(err) };
  }
}

// ─── Multipart upload bridge ─────────────────────────────────────────
// These three actions wrap the audio router's R2 multipart flow. We
// deliberately do NOT call revalidatePath on initMultipart or signPart
// — they fire on every chunk and would thrash the cache.
//
// signPartAction is the hot path: it runs N times per upload (where N
// is ceil(fileSize / 5MB)). Keep it as thin as possible.
export async function initMultipartAction(input: {
  trackVersionId: string;
  filename: string;
  sizeBytes: number;
  contentType: string;
}): Promise<ActionDataResult<{ uploadId: string; key: string; completionToken: string }>> {
  const c = await callerOrError();
  if (!c.ok) return c;
  try {
    const res = await c.caller.audio.initMultipart(input);
    return { ok: true, data: res };
  } catch (err) {
    console.error("[upload-actions]", err);
    return { ok: false, error: toSafeUploadStageError("initiation", err) };
  }
}

export async function signPartAction(input: {
  key: string;
  uploadId: string;
  partNumber: number;
  trackVersionId: string;
}): Promise<ActionDataResult<{ url: string }>> {
  const c = await callerOrError();
  if (!c.ok) return c;
  try {
    const res = await c.caller.audio.signPart(input);
    return { ok: true, data: res };
  } catch (err) {
    console.error("[upload-actions]", err);
    return { ok: false, error: toSafeUploadStageError("presign", err) };
  }
}

// Terminal action of the upload chain. Patches the track_versions row
// with the final audioUrl + size + duration. Revalidates so the song
// list re-reads and the new version shows the waveform / play state.
export async function completeMultipartAction(input: {
  key: string;
  uploadId: string;
  parts: { partNumber: number; eTag: string }[];
  trackVersionId: string;
  sizeBytes: number;
  completionToken: string;
  acknowledgePublicExposure: boolean;
  durationMs?: number;
}): Promise<ActionDataResult<{ url: string; key: string }>> {
  const c = await callerOrError();
  if (!c.ok) return c;
  try {
    const res = await c.caller.audio.completeMultipart({
      key: input.key,
      uploadId: input.uploadId,
      parts: input.parts,
      trackVersionId: input.trackVersionId,
      sizeBytes: input.sizeBytes,
      completionToken: input.completionToken,
      acknowledgePublicExposure: input.acknowledgePublicExposure,
      ...(input.durationMs === undefined ? {} : { durationMs: input.durationMs }),
    });
    revalidatePath(CLIENTS_PROJECTS_PATH);
    return { ok: true, data: res };
  } catch (err) {
    console.error("[upload-actions]", err);
    return { ok: false, error: toSafeUploadStageError("completion", err) };
  }
}

// Durable cleanup when the modal is closed mid-upload. The complete
// persisted identity is required so the audio service can journal and
// reconcile only this exact upload before the placeholder is removed.
export async function abortMultipartAction(input: {
  key: string;
  uploadId: string;
  trackVersionId: string;
  sizeBytes: number;
  completionToken: string;
}): Promise<ActionDataResult<{ ok: true }>> {
  const c = await callerOrError();
  if (!c.ok) return c;
  try {
    const res = await c.caller.audio.abortMultipart(input);
    revalidatePath(CLIENTS_PROJECTS_PATH);
    return { ok: true, data: res };
  } catch (err) {
    console.error("[upload-actions]", err);
    return { ok: false, error: toSafeUploadStageError("cancellation", err) };
  }
}

// ─── Manual stage advance ────────────────────────────────────────────
// Used by:
//   1. The Upload Track modal's optional "advance to stage" picker —
//      fires once after completeMultipart on the same trackId.
//   2. The standalone ChangeStageMenu on Song Space.
// Revalidates because the stage pill / hero eyebrow / workflow stepper
// all need to re-render after.
export async function setTrackStageAction(input: {
  trackId: string;
  workflowStage: WorkflowStage;
}): Promise<ActionDataResult<{ ok: true; workflowStage: WorkflowStage }>> {
  const c = await callerOrError();
  if (!c.ok) return c;
  try {
    const res = await c.caller.project.setTrackStage(input);
    revalidatePath(CLIENTS_PROJECTS_PATH);
    return { ok: true, data: res };
  } catch (err) {
    console.error("[upload-actions]", err);
    return { ok: false, error: toMessage(err) };
  }
}
