"use server";

import { revalidatePath } from "next/cache";
import { TRPCError } from "@trpc/server";
import { ZodError } from "zod";
import { auth } from "@clerk/nextjs/server";

import { appRouter } from "~/server/trpc/routers/_app";

export type ActionResult = { ok: true } | { ok: false; error: string };
export type ActionDataResult<T> = { ok: true; data: T } | { ok: false; error: string };

// Kanban lives at /dashboard (C.4) — the old /dashboard/deals list
// page is gone, so revalidating there would be a no-op. We point the
// list-path revalidations at the Kanban root instead.
const PATH_LIST = "/dashboard";
function pathDetail(id: string): string {
  return `/dashboard/deals/${id}`;
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
  | "archived";

export async function createDeal(input: {
  title: string;
  artistName: string;
  artistEmail: string;
  bookingId?: string;
}): Promise<ActionDataResult<{ id: string; shareToken: string }>> {
  const c = await callerOrError();
  if (!c.ok) return c;
  try {
    const res = await c.caller.deal.create(input);
    revalidatePath(PATH_LIST);
    return { ok: true, data: { id: res.deal.id, shareToken: res.shareToken } };
  } catch (err) {
    return { ok: false, error: toMessage(err) };
  }
}

export async function addDealTrack(input: {
  dealId: string;
  title: string;
  artist?: string;
}): Promise<ActionResult> {
  const c = await callerOrError();
  if (!c.ok) return c;
  try {
    await c.caller.deal.addTrack(input);
    revalidatePath(pathDetail(input.dealId));
    return { ok: true };
  } catch (err) {
    return { ok: false, error: toMessage(err) };
  }
}

export async function addTrackVersion(input: {
  dealId: string;
  trackId: string;
  label: string;
  // Nullable: "create row first, upload into it" flow passes null and
  // the AudioUploader fills audioUrl via audio.completeMultipart.
  audioUrl: string | null;
}): Promise<ActionDataResult<{ id: string }>> {
  const c = await callerOrError();
  if (!c.ok) return c;
  try {
    const row = await c.caller.deal.addVersion({
      trackId: input.trackId,
      label: input.label,
      audioUrl: input.audioUrl,
    });
    revalidatePath(pathDetail(input.dealId));
    return { ok: true, data: { id: row.id } };
  } catch (err) {
    return { ok: false, error: toMessage(err) };
  }
}

export async function setDealPaid(input: {
  dealId: string;
  kind: "deposit" | "final";
  paid: boolean;
}): Promise<ActionResult> {
  const c = await callerOrError();
  if (!c.ok) return c;
  try {
    await c.caller.deal.setPaid({
      dealId: input.dealId,
      kind: input.kind,
      value: input.paid,
    });
    revalidatePath(pathDetail(input.dealId));
    return { ok: true };
  } catch (err) {
    return { ok: false, error: toMessage(err) };
  }
}

export async function resolveVersionComment(input: {
  dealId: string;
  id: string;
  resolved: boolean;
}): Promise<ActionResult> {
  const c = await callerOrError();
  if (!c.ok) return c;
  try {
    await c.caller.deal.resolveComment({ id: input.id, resolved: input.resolved });
    revalidatePath(pathDetail(input.dealId));
    return { ok: true };
  } catch (err) {
    return { ok: false, error: toMessage(err) };
  }
}

export async function addProducerComment(input: {
  dealId: string;
  versionId: string;
  body: string;
  timestampMs: number;
}): Promise<ActionResult> {
  const c = await callerOrError();
  if (!c.ok) return c;
  try {
    await c.caller.deal.addProducerComment({
      versionId: input.versionId,
      body: input.body,
      timestampMs: input.timestampMs,
    });
    revalidatePath(pathDetail(input.dealId));
    return { ok: true };
  } catch (err) {
    return { ok: false, error: toMessage(err) };
  }
}

export async function approveVersionAction(input: {
  dealId: string;
  versionId: string;
  approved: boolean;
}): Promise<ActionResult> {
  const c = await callerOrError();
  if (!c.ok) return c;
  try {
    await c.caller.deal.approveVersion({
      versionId: input.versionId,
      approved: input.approved,
    });
    revalidatePath(pathDetail(input.dealId));
    return { ok: true };
  } catch (err) {
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
    await c.caller.deal.setStage(input);
    revalidatePath(pathDetail(input.id));
    revalidatePath(PATH_LIST);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: toMessage(err) };
  }
}
