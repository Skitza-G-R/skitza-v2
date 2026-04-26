"use server";

import { revalidatePath } from "next/cache";
import { TRPCError } from "@trpc/server";
import { ZodError } from "zod";
import { auth } from "@clerk/nextjs/server";

import { appRouter } from "~/server/trpc/routers/_app";

export type ActionResult = { ok: true } | { ok: false; error: string };
export type ActionDataResult<T> = { ok: true; data: T } | { ok: false; error: string };

// Kanban lives at /dashboard — the /dashboard/projects list page is
// gone, so revalidating there would be a no-op. We point the list-path
// revalidations at the Kanban root instead.
const PATH_LIST = "/dashboard";
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

type Stage =
  | "lead"
  | "booked"
  | "contract_sent"
  | "in_production"
  | "final_review"
  | "paid"
  | "archived"
  | "payment_paused"
  | "cancelled";

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

export async function addProjectTrack(input: {
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

export async function addTrackVersion(input: {
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

export async function setProjectPaid(input: {
  projectId: string;
  kind: "deposit" | "final";
  paid: boolean;
}): Promise<ActionResult> {
  const c = await callerOrError();
  if (!c.ok) return c;
  try {
    await c.caller.project.setPaid({
      projectId: input.projectId,
      kind: input.kind,
      value: input.paid,
    });
    revalidatePath(pathDetail(input.projectId));
    return { ok: true };
  } catch (err) {
    return { ok: false, error: toMessage(err) };
  }
}

export async function resolveVersionComment(input: {
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

export async function addProducerComment(input: {
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

export async function approveVersionAction(input: {
  projectId: string;
  versionId: string;
  approved: boolean;
}): Promise<ActionResult> {
  const c = await callerOrError();
  if (!c.ok) return c;
  try {
    await c.caller.project.approveVersion({
      versionId: input.versionId,
      approved: input.approved,
    });
    revalidatePath(pathDetail(input.projectId));
    return { ok: true };
  } catch (err) {
    return { ok: false, error: toMessage(err) };
  }
}

// Task 7 — producer-triggered off-session final charge for split_50_50
// plans. We surface Stripe's error message verbatim (e.g. "Your card
// was declined", "Insufficient funds") so the producer knows exactly
// what went wrong. The confirm-charge modal renders `error` inline so
// a retry with a different card isn't a guessing game.
export async function chargeFinalAction(input: {
  projectId: string;
}): Promise<ActionDataResult<{ paymentIntentId: string }>> {
  const c = await callerOrError();
  if (!c.ok) return c;
  try {
    const res = await c.caller.project.chargeFinal({
      projectId: input.projectId,
    });
    revalidatePath(pathDetail(input.projectId));
    return { ok: true, data: res };
  } catch (err) {
    return { ok: false, error: toMessage(err) };
  }
}

// Task 9 — producer cancels a project mid-flight. Stops Stripe future
// charges (monthly schedule cancel) and flips stage to 'cancelled'.
// Server-side title match guard is enforced inside the mutation; we
// surface its error message verbatim so the modal can render it inline.
//
// Unlike the generic toMessage() which collapses INTERNAL_SERVER_ERROR
// into "Something went wrong", a Stripe failure here carries actionable
// info ("Stripe cancel failed: <detail>") that the producer needs to
// see. We extract the raw TRPCError message rather than rewrap it.
export async function cancelProjectAction(input: {
  projectId: string;
  confirmTitle: string;
}): Promise<ActionResult> {
  const c = await callerOrError();
  if (!c.ok) return c;
  try {
    await c.caller.project.cancel(input);
    revalidatePath(pathDetail(input.projectId));
    revalidatePath(PATH_LIST);
    return { ok: true };
  } catch (err) {
    if (err instanceof TRPCError) {
      // Surface message verbatim for ALL TRPCError codes — the cancel
      // mutation crafts each one to be producer-actionable.
      return { ok: false, error: err.message || toMessage(err) };
    }
    return { ok: false, error: toMessage(err) };
  }
}

export async function setStageAction(input: {
  id: string;
  stage: Stage;
}): Promise<ActionResult> {
  const c = await callerOrError();
  if (!c.ok) return c;
  try {
    await c.caller.project.setStage(input);
    revalidatePath(pathDetail(input.id));
    revalidatePath(PATH_LIST);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: toMessage(err) };
  }
}

// Bulk stage transition for the Projects-list multi-select. Dispatches
// a single setStageBulk tRPC call — the UPDATE is scoped by
// producer_id + id IN (…) server-side so a tampered id array can't
// mutate someone else's projects. We revalidate /dashboard/projects
// (where the list lives) plus the Kanban root — both surfaces render
// the project stage.
export async function bulkSetProjectStage(input: {
  ids: string[];
  stage: Stage;
}): Promise<ActionResult> {
  const c = await callerOrError();
  if (!c.ok) return c;
  try {
    await c.caller.project.setStageBulk(input);
    revalidatePath("/dashboard/projects");
    revalidatePath(PATH_LIST);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: toMessage(err) };
  }
}

// Story 05 — Music tab drop-first uploads.
//
// Three Server Actions that wrap the projectRoom.* mutations from S02.
// These are the integration point between the new drop-first UI and
// the existing audio multipart pipeline:
//
//   createTrackFromUploadAction  — drop on empty space / pinned strip
//   addVersionFromUploadAction   — drop on existing track row's top
//   setVersionStatusAction       — bilateral status pill flip
//
// Each follows the existing actions.ts pattern (callerOrError → caller
// →  revalidatePath on success). The shape of the return mirrors the
// procedure return so the client can chain straight into the existing
// useMultipartUpload({ trackVersionId, file }) hook.
//
// Why server actions and not direct tRPC client calls: this codebase
// doesn't ship @trpc/react-query / @trpc/client — see CLAUDE.md +
// dashboard-sub-tab pattern. Server Actions are the established
// mutation surface; they call appRouter.createCaller server-side.
export async function createTrackFromUploadAction(input: {
  projectId: string;
  filename: string;
  fileSize: number;
}): Promise<
  ActionDataResult<{
    trackId: string;
    versionId: string;
    presignedMultipartInit: { uploadId: string; key: string };
  }>
> {
  const c = await callerOrError();
  if (!c.ok) return c;
  try {
    const res = await c.caller.projectRoom.createTrackFromUpload(input);
    revalidatePath(pathDetail(input.projectId));
    return { ok: true, data: res };
  } catch (err) {
    return { ok: false, error: toMessage(err) };
  }
}

export async function addVersionFromUploadAction(input: {
  projectId: string;
  trackId: string;
  filename: string;
  fileSize: number;
}): Promise<
  ActionDataResult<{
    versionId: string;
    presignedMultipartInit: { uploadId: string; key: string };
  }>
> {
  const c = await callerOrError();
  if (!c.ok) return c;
  try {
    const res = await c.caller.projectRoom.addVersionFromUpload({
      trackId: input.trackId,
      filename: input.filename,
      fileSize: input.fileSize,
    });
    revalidatePath(pathDetail(input.projectId));
    return { ok: true, data: res };
  } catch (err) {
    return { ok: false, error: toMessage(err) };
  }
}

export async function setVersionStatusAction(input: {
  projectId: string;
  versionId: string;
  status: "draft" | "revisit" | "final";
}): Promise<ActionResult> {
  const c = await callerOrError();
  if (!c.ok) return c;
  try {
    await c.caller.projectRoom.setVersionStatus({
      versionId: input.versionId,
      status: input.status,
    });
    revalidatePath(pathDetail(input.projectId));
    return { ok: true };
  } catch (err) {
    return { ok: false, error: toMessage(err) };
  }
}

// Story 06 — range-comment + resolve toggles.
//
// addRangeCommentAction wraps projectRoom.addRangeComment (S02). The
// underlying procedure already enforces endTimestampMs > timestampMs at
// the Zod boundary; we additionally guard the client-side surface so a
// malformed call (e.g. an event with a stale dragStart) returns a
// readable error rather than a 400.
//
// addPointCommentAction wraps the legacy project.addProducerComment
// procedure for the < 200ms drag fallback. Same point-comment surface
// the existing flows used; we keep the wrapper here so the new overlay
// can call a stable surface even if the legacy procedure later moves.
//
// resolveCommentAction / unresolveCommentAction wrap projectRoom's
// resolve / unresolve mutations (S02). Both return ActionResult so the
// optimistic-UI pattern can revert on failure.
export async function addRangeCommentAction(input: {
  projectId: string;
  versionId: string;
  body: string;
  timestampMs: number;
  endTimestampMs: number;
}): Promise<ActionResult> {
  const c = await callerOrError();
  if (!c.ok) return c;
  // Belt-and-braces validation. Zod refines on the server too, but
  // returning a friendly error from the action keeps the component
  // free of try/catch around an unexpected ZodError shape.
  if (input.timestampMs < 0 || input.endTimestampMs < 0) {
    return { ok: false, error: "Timestamps must be non-negative." };
  }
  if (input.endTimestampMs <= input.timestampMs) {
    return {
      ok: false,
      error: "Range end must be after the start timestamp.",
    };
  }
  try {
    await c.caller.projectRoom.addRangeComment({
      versionId: input.versionId,
      body: input.body,
      timestampMs: input.timestampMs,
      endTimestampMs: input.endTimestampMs,
    });
    revalidatePath(pathDetail(input.projectId));
    return { ok: true };
  } catch (err) {
    return { ok: false, error: toMessage(err) };
  }
}

export async function addPointCommentAction(input: {
  projectId: string;
  versionId: string;
  body: string;
  timestampMs: number;
}): Promise<ActionResult> {
  const c = await callerOrError();
  if (!c.ok) return c;
  if (input.timestampMs < 0) {
    return { ok: false, error: "Timestamp must be non-negative." };
  }
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

export async function resolveCommentAction(input: {
  projectId: string;
  commentId: string;
}): Promise<ActionResult> {
  const c = await callerOrError();
  if (!c.ok) return c;
  try {
    await c.caller.projectRoom.resolveComment({ commentId: input.commentId });
    revalidatePath(pathDetail(input.projectId));
    return { ok: true };
  } catch (err) {
    return { ok: false, error: toMessage(err) };
  }
}

export async function unresolveCommentAction(input: {
  projectId: string;
  commentId: string;
}): Promise<ActionResult> {
  const c = await callerOrError();
  if (!c.ok) return c;
  try {
    await c.caller.projectRoom.unresolveComment({
      commentId: input.commentId,
    });
    revalidatePath(pathDetail(input.projectId));
    return { ok: true };
  } catch (err) {
    return { ok: false, error: toMessage(err) };
  }
}

// Batch D — set the tag set on a single client contact. Thin wrapper
// around clientContacts.setTags. Revalidates /dashboard/projects (so
// the Project Room header picks up the new pills), /dashboard/clients
// (CRM list renders tags too), and the shell layout (sidebar-adjacent
// client counters).
export async function setClientTagsAction(input: {
  id: string;
  tags: string[];
}): Promise<ActionResult> {
  const c = await callerOrError();
  if (!c.ok) return c;
  try {
    await c.caller.clientContacts.setTags(input);
    revalidatePath("/dashboard/projects", "layout");
    revalidatePath("/dashboard/clients");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: toMessage(err) };
  }
}
