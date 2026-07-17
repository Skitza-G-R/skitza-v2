"use server";

import { revalidatePath } from "next/cache";
import { TRPCError } from "@trpc/server";
import { ZodError } from "zod";
import { auth } from "@clerk/nextjs/server";

import { appRouter } from "~/server/trpc/routers/_app";

export type ActionResult = { ok: true } | { ok: false; error: string };
export type ActionDataResult<T> = { ok: true; data: T } | { ok: false; error: string };

// Kanban lives at /dashboard — the /dashboard/clients-projects list
// page is gone, so revalidating there would be a no-op. We point the
// list-path revalidations at the Kanban root instead.
const PATH_LIST = "/dashboard";
function pathDetail(id: string): string {
  return `/dashboard/clients-projects/${id}`;
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
        return err.message || "Invalid input.";
      default:
        return "Something went wrong. Please try again.";
    }
  }
  return err instanceof Error ? err.message : "Something went wrong.";
}

// Project creation lives in clients-actions.ts and accepts only work-container
// fields. Commercial terms begin at the accepted-purchase boundary.

export async function updateProjectAction(input: {
  id: string;
  title?: string;
  artistName?: string;
  artistEmail?: string;
}): Promise<ActionResult> {
  const c = await callerOrError();
  if (!c.ok) return c;
  try {
    await c.caller.project.update(input);
    revalidatePath(pathDetail(input.id));
    revalidatePath(PATH_LIST);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: toMessage(err) };
  }
}

// Producer-only private notes for the Project Room → Notes tab. Wraps
// the project.updateNotes tRPC procedure. Returns the new updatedAt so
// the UI can render "Saved <relative>" without a refetch.
export async function updateProjectNotes(input: {
  projectId: string;
  notes: string;
}): Promise<ActionDataResult<{ updatedAt: Date }>> {
  const c = await callerOrError();
  if (!c.ok) return c;
  try {
    const res = await c.caller.project.updateNotes({
      projectId: input.projectId,
      notes: input.notes,
    });
    revalidatePath(pathDetail(input.projectId));
    return { ok: true, data: { updatedAt: res.updatedAt } };
  } catch (err) {
    return { ok: false, error: toMessage(err) };
  }
}

export async function updateTrackTitle(input: {
  projectId: string;
  trackId: string;
  title: string;
}): Promise<ActionResult> {
  const c = await callerOrError();
  if (!c.ok) return c;
  try {
    await c.caller.project.updateTrackTitle({
      projectId: input.projectId,
      trackId: input.trackId,
      title: input.title,
    });
    revalidatePath(pathDetail(input.projectId));
    return { ok: true };
  } catch (err) {
    return { ok: false, error: toMessage(err) };
  }
}

export async function updateVersionLabel(input: {
  projectId: string;
  versionId: string;
  label: string;
}): Promise<ActionResult> {
  const c = await callerOrError();
  if (!c.ok) return c;
  try {
    await c.caller.project.updateVersionLabel({
      projectId: input.projectId,
      versionId: input.versionId,
      label: input.label,
    });
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
  // Placeholder-only; the multipart completion boundary supplies audio.
  audioUrl: null;
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
    revalidatePath("/dashboard/clients-projects", "layout");
    revalidatePath("/dashboard/clients");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: toMessage(err) };
  }
}
