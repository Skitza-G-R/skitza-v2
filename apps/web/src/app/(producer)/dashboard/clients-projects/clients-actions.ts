"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { TRPCError } from "@trpc/server";
import { ZodError } from "zod";
import { auth } from "~/server/auth/clerk-identity";

import { appRouter } from "~/server/trpc/routers/_app";

export type ActionResult = { ok: true } | { ok: false; error: string };
export type ActionDataResult<T> = { ok: true; data: T } | { ok: false; error: string };

export type ClientInviteActionResult =
  | {
      ok: true;
      data:
        | { via: "link"; deliveryState: null; providerAcceptedAtIso: null }
        | { via: "email"; deliveryState: "sending"; providerAcceptedAtIso: null }
        | {
            via: "email";
            deliveryState: "provider_accepted";
            providerAcceptedAtIso: string;
          };
    }
  | {
      ok: false;
      error: string;
      code?: "new_operation_required";
    };

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

// Thin wrapper for clientContacts.sendInvite. An email is "Invited" only
// after the provider accepts it. Copying a link keeps the deletion-safety
// stamp but never creates invitation evidence for the UI.
//
// All other server actions from the pre-Phase-1 panels (createClient /
// removeClient / updateClient / fetchClientDetail) were dropped along
// with the panels themselves in the redesign deletion sweep.
export async function sendClientInviteAction(input: {
  id: string;
  via: "email" | "link";
  operationKey: string;
}): Promise<ClientInviteActionResult> {
  const c = await callerOrError();
  if (!c.ok) return c;
  try {
    const res = await c.caller.clientContacts.sendInvite(input);
    revalidatePath(CLIENTS_PATH);
    if (!("deliveryState" in res)) {
      if (res.via !== "link") {
        return { ok: false, error: "Skitza could not verify this send. Try again." };
      }
      return {
        ok: true,
        data: { via: "link", deliveryState: null, providerAcceptedAtIso: null },
      };
    }
    if (res.deliveryState === "sending") {
      return {
        ok: true,
        data: { via: "email", deliveryState: "sending", providerAcceptedAtIso: null },
      };
    }
    return {
      ok: true,
      data: {
        via: "email",
        deliveryState: "provider_accepted",
        providerAcceptedAtIso: res.providerAcceptedAt.toISOString(),
      },
    };
  } catch (err) {
    console.error("[clients-actions]", err);
    if (err instanceof TRPCError && err.code === "CONFLICT") {
      return {
        ok: false,
        error: "This send can’t be retried. Choose Try a new send.",
        code: "new_operation_required",
      };
    }
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
// Create + sendInvite are decoupled: provider acceptance, an in-flight
// delivery, and a failed delivery remain distinct. The client row stays
// saved in every case; only provider acceptance becomes Invited evidence.
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
        invitationState: "provider_accepted";
        invitedAtIso: string;
      }
    | { existed: false; id: string; invitationState: "sending" }
    | { existed: false; id: string; invitationState: "failed" }
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
  // Client row is in the DB. From here, invitation delivery remains a
  // soft outcome so the modal can report the saved client separately.
  try {
    const sent = await c.caller.clientContacts.sendInvite({
      id: createdId,
      via: "email",
      operationKey: `new-client-invite:${createdId}:${randomUUID()}`,
    });
    revalidatePath(CLIENTS_PATH);
    if (!("deliveryState" in sent)) {
      throw new Error("Invitation provider state is missing");
    }
    if (sent.deliveryState === "sending") {
      return {
        ok: true,
        data: { existed: false, id: createdId, invitationState: "sending" },
      };
    }
    return {
      ok: true,
      data: {
        existed: false,
        id: createdId,
        invitationState: "provider_accepted",
        invitedAtIso: sent.providerAcceptedAt.toISOString(),
      },
    };
  } catch (sendErr) {
    console.error("[clients-actions:createClient] invite send failed", sendErr);
    revalidatePath(CLIENTS_PATH);
    return {
      ok: true,
      data: { existed: false, id: createdId, invitationState: "failed" },
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
