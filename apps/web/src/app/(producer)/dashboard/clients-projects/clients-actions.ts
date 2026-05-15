"use server";

import { revalidatePath } from "next/cache";
import { TRPCError } from "@trpc/server";
import { ZodError } from "zod";
import { auth } from "@clerk/nextjs/server";

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

// Thin wrapper for clientContacts.sendInvite. The Invite-to-App modal
// calls this with via='email' (real Resend dispatch) or via='link'
// (the producer copied the URL to clipboard — server side only stamps
// invited_at). On success, revalidates the list path so the LinkPill
// flips from "Invite to app" → "Invited" without a hard reload.
//
// All other server actions from the pre-Phase-1 panels (createClient /
// removeClient / updateClient / fetchClientDetail) were dropped along
// with the panels themselves in the redesign deletion sweep.
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

// New Client modal (Clients & Projects v3 redesign, Phase 1 G6).
// Creates a client + auto-sends the invite email so the modal can be
// a single "Add client" CTA. Two-step internally so we can surface the
// `existed: true` short-circuit to the UI without sending a duplicate
// invite. On `existed: true` the modal redirects to the client's space
// instead of pretending an invite went out.
//
// Field defaults: phone/notes are forwarded straight through. The
// tRPC procedure trims + nulls whitespace and clamps the size — we
// don't replicate that contract here.
export async function createClientAction(input: {
  name: string;
  email: string;
  phone?: string;
  notes?: string;
}): Promise<
  ActionDataResult<
    | { existed: true; id: string }
    | { existed: false; id: string; invitedAtIso: string }
  >
> {
  const c = await callerOrError();
  if (!c.ok) return c;
  try {
    const created = await c.caller.clientContacts.create(input);
    if (created.existed) {
      // Existing row — do NOT re-send an invite. The UI redirects to
      // the client's space so the producer sees what they already have.
      revalidatePath(CLIENTS_PATH);
      return { ok: true, data: { existed: true, id: created.id } };
    }
    const sent = await c.caller.clientContacts.sendInvite({
      id: created.id,
      via: "email",
    });
    revalidatePath(CLIENTS_PATH);
    return {
      ok: true,
      data: {
        existed: false,
        id: created.id,
        invitedAtIso:
          sent.invitedAt instanceof Date
            ? sent.invitedAt.toISOString()
            : new Date(sent.invitedAt).toISOString(),
      },
    };
  } catch (err) {
    return { ok: false, error: toMessage(err) };
  }
}

// Reorder wrappers for the drag-to-reorder UX on the Clients & Projects
// list view. The tRPC mutations (clientContacts.reorder, projects.reorder)
// verify ownership + atomically rewrite the `position` column.
// revalidatePath fires after success so the next read returns rows in
// the new order. Ownership re-check lives inside the tRPC procedures
// — do not remove it there.

export async function reorderClientsAction(
  orderedIds: string[],
): Promise<ActionResult> {
  const c = await callerOrError();
  if (!c.ok) return c;
  try {
    await c.caller.clientContacts.reorder({ orderedIds });
    revalidatePath(CLIENTS_PATH);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: toMessage(err) };
  }
}

export async function reorderProjectsAction(
  orderedIds: string[],
): Promise<ActionResult> {
  const c = await callerOrError();
  if (!c.ok) return c;
  try {
    await c.caller.project.reorder({ orderedIds });
    revalidatePath(CLIENTS_PATH);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: toMessage(err) };
  }
}
