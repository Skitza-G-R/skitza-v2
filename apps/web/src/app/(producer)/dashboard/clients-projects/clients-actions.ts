"use server";

import { revalidatePath } from "next/cache";
import { TRPCError } from "@trpc/server";
import { ZodError } from "zod";
import { auth } from "@clerk/nextjs/server";

import type { Stage } from "~/lib/projects/stages";
import { appRouter } from "~/server/trpc/routers/_app";

export type ActionResult = { ok: true } | { ok: false; error: string };
export type ActionDataResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

const CLIENTS_PATH = "/dashboard/clients-projects";

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
        return "Client not found.";
      case "FORBIDDEN":
        return "You don't have access to that client.";
      case "CONFLICT":
        return err.message || "A client with that email already exists.";
      case "BAD_REQUEST":
        return err.message || "Invalid input.";
      default:
        return "Something went wrong. Please try again.";
    }
  }
  return err instanceof Error ? err.message : "Something went wrong.";
}

export async function createClient(input: {
  name: string;
  email: string;
}): Promise<ActionDataResult<{ id: string; existed: boolean }>> {
  const c = await callerOrError();
  if (!c.ok) return c;
  try {
    const res = await c.caller.clientContacts.create(input);
    revalidatePath(CLIENTS_PATH);
    return { ok: true, data: { id: res.id, existed: res.existed } };
  } catch (err) {
    return { ok: false, error: toMessage(err) };
  }
}

export async function removeClient(input: {
  id: string;
}): Promise<ActionResult> {
  const c = await callerOrError();
  if (!c.ok) return c;
  try {
    await c.caller.clientContacts.remove({ id: input.id });
    revalidatePath(CLIENTS_PATH);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: toMessage(err) };
  }
}

// Clients & Projects v3 redesign — Phase 1 Task 11. Server Action
// wrapper for clientContacts.sendInvite. The Invite-to-App modal calls
// this with via='email' (real Resend dispatch) or via='link' (the
// producer copied the URL to clipboard — server side only stamps
// invited_at). On success, revalidates the list path so the LinkPill
// flips from "Invite to app" → "Invited" without a hard reload.
export async function sendClientInviteAction(input: {
  id: string;
  via: "email" | "link";
}): Promise<ActionDataResult<{ invitedAtIso: string; via: "email" | "link" }>> {
  const c = await callerOrError();
  if (!c.ok) return c;
  try {
    const res = await c.caller.clientContacts.sendInvite(input);
    revalidatePath(CLIENTS_PATH);
    return {
      ok: true,
      data: {
        invitedAtIso:
          res.invitedAt instanceof Date
            ? res.invitedAt.toISOString()
            : new Date(res.invitedAt).toISOString(),
        via: res.via,
      },
    };
  } catch (err) {
    return { ok: false, error: toMessage(err) };
  }
}

// Dispatches to two tRPC procedures based on which fields are passed:
//   - clientContacts.update       — name / email (id-collision aware)
//   - clientContacts.updateClientMeta — notes / tags (CRM meta)
// Brief said "updateClientMeta" only, but verifying its schema showed
// name + email aren't accepted there, so we route them to `update`.
export async function updateClient(input: {
  id: string;
  name?: string;
  email?: string;
  notes?: string;
  tags?: string[];
}): Promise<ActionResult> {
  const c = await callerOrError();
  if (!c.ok) return c;
  try {
    if (input.name !== undefined || input.email !== undefined) {
      await c.caller.clientContacts.update({
        id: input.id,
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.email !== undefined ? { email: input.email } : {}),
      });
    }
    if (input.notes !== undefined || input.tags !== undefined) {
      await c.caller.clientContacts.updateClientMeta({
        id: input.id,
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
        ...(input.tags !== undefined ? { tags: input.tags } : {}),
      });
    }
    revalidatePath(CLIENTS_PATH);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: toMessage(err) };
  }
}

export type ClientDetailProjectRow = {
  id: string;
  title: string;
  stage: Stage;
  updatedAtIso: string;
  priceCents: number;
  currency: string;
  outstandingCents: number;
  finalPaid: boolean;
};

export type ClientDetailData = {
  contact: {
    id: string;
    email: string;
    name: string;
    notes: string | null;
    tags: string[] | null;
  };
  projects: ClientDetailProjectRow[];
};

export async function fetchClientDetail(input: {
  id: string;
}): Promise<ActionDataResult<ClientDetailData>> {
  const c = await callerOrError();
  if (!c.ok) return c;
  try {
    const res = await c.caller.clientContacts.detail({ id: input.id });
    const projects: ClientDetailProjectRow[] = res.projects.map((p) => ({
      id: p.id,
      title: p.title,
      stage: p.stage,
      updatedAtIso:
        p.updatedAt instanceof Date
          ? p.updatedAt.toISOString()
          : new Date(p.updatedAt).toISOString(),
      priceCents: p.priceCents,
      currency: p.currency ?? "USD",
      outstandingCents: p.outstandingCents,
      finalPaid: p.finalPaid,
    }));
    return {
      ok: true,
      data: {
        contact: {
          id: res.contact.id,
          email: res.contact.email,
          name: res.contact.name,
          notes: res.contact.notes,
          tags: res.contact.tags,
        },
        projects,
      },
    };
  } catch (err) {
    return { ok: false, error: toMessage(err) };
  }
}
