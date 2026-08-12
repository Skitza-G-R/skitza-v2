"use server";

import { auth } from "@clerk/nextjs/server";
import { TRPCError } from "@trpc/server";
import { revalidatePath } from "next/cache";

import type { PrivateOfferRecipient, PrivateOfferTarget } from "~/server/domain/private-offers/db";
import type { PrivateOfferInput } from "~/server/domain/private-offers/service";
import { appRouter } from "~/server/trpc/routers/_app";

type ActionFailure = { ok: false; error: string };
type ActionSuccess<T> = { ok: true; data: T };

export type SendPrivateOfferPayload = {
  /** Generate once per logical send and reuse unchanged for every retry. */
  offerId: string;
  /** Present only when this independent offer snapshot started from a Store product. */
  sourceProductId?: string;
  recipient: PrivateOfferRecipient;
  target: PrivateOfferTarget;
  terms: PrivateOfferInput;
  expiresAt: string;
};

export type UpdatePrivateOfferPayload = SendPrivateOfferPayload & {
  offerId: string;
  expectedUpdatedAt: string;
};

export type PrivateOfferProjectOption = Readonly<{
  id: string;
  title: string;
  createdAtIso: string;
  lifecycleStatus: "waiting_for_payment" | "active";
  songCount: number;
  balances: readonly Readonly<{ currency: string; remainingCents: number }>[];
}>;

export type ClientPrivateOfferSummary = Readonly<{
  id: string;
  status: "draft" | "sent" | "accepted" | "declined" | "expired" | "canceled";
  name: string;
  totalCents: number;
  currency: string;
  targetProjectTitle: string | null;
  expiresAtIso: string;
}>;

function safeDate(raw: string): Date | null {
  const value = new Date(raw);
  return Number.isNaN(value.getTime()) ? null : value;
}

function actionFailure(error: unknown): ActionFailure {
  if (error instanceof TRPCError) {
    return { ok: false, error: error.message || "This offer is unavailable." };
  }
  return { ok: false, error: "Couldn't save this offer. Try again." };
}

function revalidateOfferSurfaces(clientContactId?: string): void {
  revalidatePath("/dashboard/store");
  revalidatePath("/artist", "layout");
  if (clientContactId) {
    revalidatePath(`/dashboard/clients-projects/clients/${clientContactId}`);
  }
}

export async function loadPrivateOfferProjectOptionsAction(
  clientContactId: string,
): Promise<ActionSuccess<PrivateOfferProjectOption[]> | ActionFailure> {
  const { userId } = await auth();
  if (!userId) return { ok: false, error: "Not signed in" };

  try {
    const caller = appRouter.createCaller({ userId });
    const result = await caller.privateOffers.projectOptions({ clientContactId });
    return {
      ok: true,
      data: result.projects.map(({ createdAt, ...project }) => ({
        ...project,
        createdAtIso: createdAt.toISOString(),
      })),
    };
  } catch (error) {
    return actionFailure(error);
  }
}

export async function loadClientPrivateOffersAction(
  clientContactId: string,
): Promise<ActionSuccess<ClientPrivateOfferSummary[]> | ActionFailure> {
  const { userId } = await auth();
  if (!userId) return { ok: false, error: "Not signed in" };

  try {
    const caller = appRouter.createCaller({ userId });
    const result = await caller.privateOffers.producerList();
    return {
      ok: true,
      data: result.offers
        .filter((offer) => offer.clientContactId === clientContactId)
        .map((offer) => ({
          id: offer.id,
          status: offer.status,
          name: offer.commercialDraft.productOrOfferName,
          totalCents: offer.commercialDraft.totalCents,
          currency: offer.commercialDraft.currency,
          targetProjectTitle: offer.targetProjectTitle,
          expiresAtIso: offer.expiresAt.toISOString(),
        })),
    };
  } catch (error) {
    if (error instanceof TRPCError) {
      return { ok: false, error: error.message || "Could not load private offers." };
    }
    return { ok: false, error: "Could not load private offers. Try again." };
  }
}

export async function sendPrivateOfferAction(
  input: SendPrivateOfferPayload,
): Promise<ActionSuccess<{ id: string; emailDelivered: boolean | null }> | ActionFailure> {
  const { userId } = await auth();
  if (!userId) return { ok: false, error: "Not signed in" };
  const expiresAt = safeDate(input.expiresAt);
  if (!expiresAt) return { ok: false, error: "Choose a valid expiry date." };

  try {
    const caller = appRouter.createCaller({ userId });
    const result = await caller.privateOffers.send({
      offerId: input.offerId,
      ...(input.sourceProductId ? { sourceProductId: input.sourceProductId } : {}),
      recipient: input.recipient,
      target: input.target,
      terms: input.terms,
      expiresAt,
    });
    revalidateOfferSurfaces(
      input.recipient.kind === "existing" ? input.recipient.clientContactId : undefined,
    );
    return {
      ok: true,
      data: { id: result.offerId, emailDelivered: result.emailDelivered },
    };
  } catch (error) {
    return actionFailure(error);
  }
}

export async function updatePrivateOfferAction(
  input: UpdatePrivateOfferPayload,
): Promise<ActionSuccess<{ id: string }> | ActionFailure> {
  const { userId } = await auth();
  if (!userId) return { ok: false, error: "Not signed in" };
  const expiresAt = safeDate(input.expiresAt);
  const expectedUpdatedAt = safeDate(input.expectedUpdatedAt);
  if (!expiresAt || !expectedUpdatedAt) {
    return { ok: false, error: "Refresh this offer and try again." };
  }

  try {
    const caller = appRouter.createCaller({ userId });
    const result = await caller.privateOffers.update({
      offerId: input.offerId,
      expectedUpdatedAt,
      target: input.target,
      terms: input.terms,
      expiresAt,
    });
    revalidateOfferSurfaces(
      input.recipient.kind === "existing" ? input.recipient.clientContactId : undefined,
    );
    return { ok: true, data: { id: result.offerId } };
  } catch (error) {
    return actionFailure(error);
  }
}

export async function cancelPrivateOfferAction(
  offerId: string,
): Promise<ActionSuccess<{ changed: boolean }> | ActionFailure> {
  const { userId } = await auth();
  if (!userId) return { ok: false, error: "Not signed in" };
  try {
    const caller = appRouter.createCaller({ userId });
    const result = await caller.privateOffers.cancel({ offerId });
    revalidateOfferSurfaces();
    return { ok: true, data: result };
  } catch (error) {
    return actionFailure(error);
  }
}
