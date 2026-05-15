"use server";

import { revalidatePath } from "next/cache";
import { TRPCError } from "@trpc/server";
import { ZodError } from "zod";
import { auth } from "@clerk/nextjs/server";

import { appRouter } from "~/server/trpc/routers/_app";
import type { WorkflowStage } from "~/lib/clients/workflow-stage";

// ─── Result types ────────────────────────────────────────────────────
// Mirrors the convention in clients-actions.ts so the Upload Track
// modal can `if (!res.ok) throw new Error(res.error)` on any failure.
export type ActionResult = { ok: true } | { ok: false; error: string };
export type ActionDataResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

const CLIENTS_PROJECTS_PATH = "/dashboard/clients-projects";

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

// ─── Track + version creation ────────────────────────────────────────
// Creates a new project_tracks row for the "+ New song" picker in the
// Upload Track modal. Revalidates the album page so the new track
// appears once the rest of the chain finishes.
export async function addTrackAction(input: {
  projectId: string;
  title: string;
  artist?: string;
}): Promise<
  ActionDataResult<{ id: string; projectId: string; title: string }>
> {
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
    return { ok: false, error: toMessage(err) };
  }
}

// Inserts a new track_versions row with audioUrl=null. The upload
// pipeline patches this row inside completeMultipart once R2 confirms.
// Revalidates the song-space path so the new version appears in the
// list even if the producer reloads mid-upload.
export async function addVersionAction(input: {
  trackId: string;
  label: string;
  audioUrl: string | null;
  durationMs?: number;
  description?: string;
}): Promise<
  ActionDataResult<{ id: string; trackId: string; label: string }>
> {
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
    revalidatePath(CLIENTS_PROJECTS_PATH);
    return {
      ok: true,
      data: { id: row.id, trackId: row.trackId, label: row.label },
    };
  } catch (err) {
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
}): Promise<ActionDataResult<{ uploadId: string; key: string }>> {
  const c = await callerOrError();
  if (!c.ok) return c;
  try {
    const res = await c.caller.audio.initMultipart(input);
    return { ok: true, data: res };
  } catch (err) {
    return { ok: false, error: toMessage(err) };
  }
}

export async function signPartAction(input: {
  key: string;
  uploadId: string;
  partNumber: number;
}): Promise<ActionDataResult<{ url: string }>> {
  const c = await callerOrError();
  if (!c.ok) return c;
  try {
    const res = await c.caller.audio.signPart(input);
    return { ok: true, data: res };
  } catch (err) {
    return { ok: false, error: toMessage(err) };
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
      ...(input.durationMs === undefined ? {} : { durationMs: input.durationMs }),
    });
    revalidatePath(CLIENTS_PROJECTS_PATH);
    return { ok: true, data: res };
  } catch (err) {
    return { ok: false, error: toMessage(err) };
  }
}

// Best-effort cleanup when the modal is closed mid-upload. Also fires
// from the chunk loop if any signed PUT fails — we don't want to
// leave half-uploaded parts hanging in R2. Revalidates so the orphan
// track_versions row (which we wrote before R2 init) is re-read; the
// audio router doesn't delete the DB row on abort, so the producer
// still sees the pending version + can retry.
export async function abortMultipartAction(input: {
  key: string;
  uploadId: string;
}): Promise<ActionDataResult<{ ok: true }>> {
  const c = await callerOrError();
  if (!c.ok) return c;
  try {
    const res = await c.caller.audio.abortMultipart(input);
    revalidatePath(CLIENTS_PROJECTS_PATH);
    return { ok: true, data: res };
  } catch (err) {
    return { ok: false, error: toMessage(err) };
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
}): Promise<
  ActionDataResult<{ ok: true; workflowStage: WorkflowStage }>
> {
  const c = await callerOrError();
  if (!c.ok) return c;
  try {
    const res = await c.caller.project.setTrackStage(input);
    revalidatePath(CLIENTS_PROJECTS_PATH);
    return { ok: true, data: res };
  } catch (err) {
    return { ok: false, error: toMessage(err) };
  }
}
