"use server";

import { revalidatePath } from "next/cache";
import { TRPCError } from "@trpc/server";
import { ZodError } from "zod";
import { auth } from "~/server/auth/clerk-identity";

import { appRouter } from "~/server/trpc/routers/_app";

export type ActionResult = { ok: true } | { ok: false; error: string };
export type ActionDataResult<T> = { ok: true; data: T } | { ok: false; error: string };

const CLIENTS_PATH = "/dashboard/clients-projects";

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
      case "NOT_FOUND":
        return "Client not found.";
      case "FORBIDDEN":
        return "You don't have access to that client.";
      case "CONFLICT":
        return err.message || "A client with that email already exists.";
      case "BAD_REQUEST":
        return err.message || "Invalid input.";
      case "PRECONDITION_FAILED":
        return err.message || "Only an empty draft can be permanently deleted.";
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
    console.error("[clients-actions]", err);
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
// Create + sendInvite are decoupled: a failed email send (Resend
// sandbox / unverified domain / rate-limit) still reports the create
// as a success with `inviteEmailFailed: true` so the producer doesn't
// see a generic toast and assume nothing happened. The DB row exists
// and invited_at stays NULL (sendInvite sends email before stamping),
// so the LinkPill on the client space shows "Invite to app" and the
// producer can retry from there.
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
    | {
        existed: false;
        id: string;
        inviteEmailFailed: false;
        invitedAtIso: string;
      }
    | { existed: false; id: string; inviteEmailFailed: true }
  >
> {
  const c = await callerOrError();
  if (!c.ok) return c;
  let createdId: string;
  try {
    const created = await c.caller.clientContacts.create(input);
    if (created.existed) {
      // Existing row — do NOT re-send an invite. The UI redirects to
      // the client's space so the producer sees what they already have.
      revalidatePath(CLIENTS_PATH);
      return { ok: true, data: { existed: true, id: created.id } };
    }
    createdId = created.id;
  } catch (err) {
    console.error("[clients-actions]", err);
    return { ok: false, error: toMessage(err) };
  }
  // Client row is in the DB. From here, an email failure is reported
  // as a soft failure (ok:true + inviteEmailFailed) so the modal can
  // tell the producer the client was added but the email didn't go.
  try {
    const sent = await c.caller.clientContacts.sendInvite({
      id: createdId,
      via: "email",
    });
    revalidatePath(CLIENTS_PATH);
    return {
      ok: true,
      data: {
        existed: false,
        id: createdId,
        inviteEmailFailed: false,
        invitedAtIso:
          sent.invitedAt instanceof Date
            ? sent.invitedAt.toISOString()
            : new Date(sent.invitedAt).toISOString(),
      },
    };
  } catch (sendErr) {
    console.error("[clients-actions:createClient] invite send failed", sendErr);
    revalidatePath(CLIENTS_PATH);
    return {
      ok: true,
      data: { existed: false, id: createdId, inviteEmailFailed: true },
    };
  }
}

// New Project modal (Clients & Projects v3 redesign, Phase 1 G7).
// Thin wrapper around project.create. This action creates a work
// container for a stable client; it deliberately does not accept or
// infer product, fee, deposit, or other purchase terms. The underlying
// mutation handles validation + the recordContact side-effect. We
// revalidate the list path so the new project row shows up without a
// hard reload.
//
// Mirrors createClientAction's error-handling pattern: ZodError +
// TRPCError both round-trip through toMessage() so the modal can
// surface "field: message" hints directly.
export async function createProjectAction(input: {
  title: string;
  clientContactId?: string;
  newClient?: { name: string; email: string };
  deadlineAt?: string;
}): Promise<ActionDataResult<{ id: string }>> {
  const c = await callerOrError();
  if (!c.ok) return c;
  try {
    let clientContactId = input.clientContactId;
    if (!clientContactId && input.newClient) {
      const client = await c.caller.clientContacts.create({
        name: input.newClient.name,
        email: input.newClient.email,
      });
      clientContactId = client.id;
    }
    if (!clientContactId) {
      return { ok: false, error: "Choose a client before creating the project." };
    }
    // Conditional-spread to satisfy exactOptionalPropertyTypes — never
    // pass `undefined` as a property value. Deadline is forwarded only
    // when the caller actually filled it in.
    const payload: {
      title: string;
      clientContactId: string;
      deadlineAt?: string;
    } = {
      title: input.title,
      clientContactId,
    };
    if (input.deadlineAt) payload.deadlineAt = input.deadlineAt;
    const res = await c.caller.project.create(payload);
    revalidatePath(CLIENTS_PATH);
    return { ok: true, data: { id: res.project.id } };
  } catch (err) {
    console.error("[clients-actions:createProject]", err);
    return { ok: false, error: toMessage(err) };
  }
}

// Edit + Remove client wrappers (PR #130). Restored variants of the
// pre-Phase-1 actions, now wired to the Client Space hero menu.
//
// updateClientAction: thin wrapper over clientContacts.update. Accepts
// any subset of name/email/phone/notes/tags — only changed fields are sent.
// Null for phone/notes explicitly clears the column (the modal sends
// the empty-string form normalised to null).
//
// removeClientAction: thin wrapper over the empty-draft deletion boundary.
// Historical, invited, connected, disconnected, or archived clients fail
// closed; the server never removes a CRM row while keeping detached history.

export async function updateClientAction(input: {
  id: string;
  name?: string;
  email?: string;
  phone?: string | null;
  notes?: string | null;
  tags?: string[];
}): Promise<
  ActionDataResult<{
    id: string;
    name: string;
    email: string;
    phone: string | null;
    notes: string | null;
    tags: string[];
  }>
> {
  const c = await callerOrError();
  if (!c.ok) return c;
  try {
    // exactOptionalPropertyTypes: never pass `undefined` keys.
    const payload: {
      id: string;
      name?: string;
      email?: string;
      phone?: string | null;
      notes?: string | null;
      tags?: string[];
    } = { id: input.id };
    if (input.name !== undefined) payload.name = input.name;
    if (input.email !== undefined) payload.email = input.email;
    if (input.phone !== undefined) payload.phone = input.phone;
    if (input.notes !== undefined) payload.notes = input.notes;
    if (input.tags !== undefined) payload.tags = input.tags;
    const res = await c.caller.clientContacts.update(payload);
    revalidatePath(CLIENTS_PATH);
    revalidatePath(`${CLIENTS_PATH}/clients/${input.id}`);
    return {
      ok: true,
      data: {
        id: res.id,
        name: res.name,
        email: res.email,
        phone: res.phone ?? null,
        notes: res.notes ?? null,
        tags: res.tags,
      },
    };
  } catch (err) {
    console.error("[clients-actions:updateClient]", err);
    return { ok: false, error: toMessage(err) };
  }
}

export async function archiveClientAction(input: {
  id: string;
}): Promise<{ ok: true } | { ok: false; error: string; code?: "BLOCKING_PROJECT" }> {
  const c = await callerOrError();
  if (!c.ok) return c;
  try {
    await c.caller.clientContacts.archive(input);
    revalidatePath(CLIENTS_PATH);
    revalidatePath(`${CLIENTS_PATH}/clients/${input.id}`);
    return { ok: true };
  } catch (err) {
    console.error("[clients-actions:archiveClient]", err);
    const error = toMessage(err);
    if (err instanceof TRPCError && err.code === "PRECONDITION_FAILED") {
      return { ok: false, error, code: "BLOCKING_PROJECT" };
    }
    return { ok: false, error };
  }
}

export async function restoreClientAction(input: { id: string }): Promise<ActionResult> {
  const c = await callerOrError();
  if (!c.ok) return c;
  try {
    await c.caller.clientContacts.restore(input);
    revalidatePath(CLIENTS_PATH);
    revalidatePath(`${CLIENTS_PATH}/clients/${input.id}`);
    return { ok: true };
  } catch (err) {
    console.error("[clients-actions:restoreClient]", err);
    return { ok: false, error: toMessage(err) };
  }
}

export async function removeClientAction(input: { id: string }): Promise<ActionResult> {
  const c = await callerOrError();
  if (!c.ok) return c;
  try {
    await c.caller.clientContacts.remove({ id: input.id });
    revalidatePath(CLIENTS_PATH);
    return { ok: true };
  } catch (err) {
    console.error("[clients-actions:removeClient]", err);
    return { ok: false, error: toMessage(err) };
  }
}

// Reorder wrappers for the drag-to-reorder UX on the Clients & Projects
// list view. The tRPC mutations (clientContacts.reorder, projects.reorder)
// verify ownership + atomically rewrite the `position` column.
// revalidatePath fires after success so the next read returns rows in
// the new order. Ownership re-check lives inside the tRPC procedures
// — do not remove it there.

export async function reorderClientsAction(orderedIds: string[]): Promise<ActionResult> {
  const c = await callerOrError();
  if (!c.ok) return c;
  try {
    await c.caller.clientContacts.reorder({ orderedIds });
    revalidatePath(CLIENTS_PATH);
    return { ok: true };
  } catch (err) {
    console.error("[clients-actions]", err);
    return { ok: false, error: toMessage(err) };
  }
}

export async function reorderProjectsAction(orderedIds: string[]): Promise<ActionResult> {
  const c = await callerOrError();
  if (!c.ok) return c;
  try {
    await c.caller.project.reorder({ orderedIds });
    revalidatePath(CLIENTS_PATH);
    return { ok: true };
  } catch (err) {
    console.error("[clients-actions]", err);
    return { ok: false, error: toMessage(err) };
  }
}
