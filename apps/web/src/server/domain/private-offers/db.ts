import {
  and,
  clientContacts,
  desc,
  eq,
  gt,
  inArray,
  isNull,
  lte,
  notifications,
  privateOffers,
  producers,
  products,
  projectTracks,
  projects,
  purchaseAcceptances,
  purchases,
  sql,
  type Db,
  type PaymentPlan,
  type PurchaseCommercialSnapshot,
} from "@skitza/db";

import { emailHashFor } from "~/server/artist/identity";
import { clientMoneyRepository } from "~/server/domain/client-money/db";
import { getClientMoneyLedger } from "~/server/domain/client-money/service";
import { loadArtistPurchaseGuard } from "~/server/domain/purchase-requests/active-guard";
import { purchaseRepositoryForTransaction } from "~/server/domain/purchases/db";
import { digestCommercialSnapshot } from "~/server/domain/purchases/policy";
import { acceptPurchase } from "~/server/domain/purchases/service";
import {
  assertPrivateOfferActionAllowed,
  buildPrivateOfferSnapshot,
  defaultPrivateOfferExpiry,
  finalizePrivateOfferSnapshot,
  isPrivateOfferExpired,
  privateOfferPaymentPlanKey,
  type PrivateOfferInput,
} from "./service";

export type PrivateOfferRecipient =
  | Readonly<{ kind: "existing"; clientContactId: string }>
  | Readonly<{ kind: "new"; name: string; email: string }>;

export type PrivateOfferTarget =
  | Readonly<{ kind: "new" }>
  | Readonly<{ kind: "existing"; projectId: string }>;

export type PrivateOfferPersistenceErrorCode =
  | "NOT_FOUND"
  | "UNAVAILABLE"
  | "STALE"
  | "ACTIVE_PURCHASE"
  | "INTEGRITY";

export class PrivateOfferPersistenceError extends Error {
  readonly code: PrivateOfferPersistenceErrorCode;

  constructor(code: PrivateOfferPersistenceErrorCode, message = "This offer is unavailable.") {
    super(message);
    this.name = "PrivateOfferPersistenceError";
    this.code = code;
  }
}

type PrivateOfferStatus = "draft" | "sent" | "accepted" | "declined" | "expired" | "canceled";
type TransactionDb = Parameters<Parameters<Db["transaction"]>[0]>[0];

function unavailable(): never {
  throw new PrivateOfferPersistenceError("UNAVAILABLE");
}

function notFound(): never {
  throw new PrivateOfferPersistenceError("NOT_FOUND");
}

function normalizeRecipientEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

type PrivateOfferRow = typeof privateOffers.$inferSelect;

function assertExactPrivateOfferReplay(
  existing: PrivateOfferRow,
  input: {
    producerId: string;
    sourceProductId?: string;
    recipient: PrivateOfferRecipient;
    target: PrivateOfferTarget;
    snapshot: PurchaseCommercialSnapshot;
    expiresAt: Date;
  },
): void {
  if (existing.producerId !== input.producerId) unavailable();
  const recipientMatches =
    input.recipient.kind === "existing"
      ? existing.clientContactId === input.recipient.clientContactId
      : existing.recipientEmailHash ===
        emailHashFor(normalizeRecipientEmail(input.recipient.email));
  const targetMatches =
    input.target.kind === "new"
      ? existing.targetProjectId === null
      : existing.targetProjectId === input.target.projectId;
  const sourceMatches = existing.productId === (input.sourceProductId ?? null);
  const termsMatch =
    digestCommercialSnapshot(existing.commercialDraft) === digestCommercialSnapshot(input.snapshot);
  const expiryMatches = existing.expiresAt.getTime() === input.expiresAt.getTime();
  if (!recipientMatches || !targetMatches || !sourceMatches || !termsMatch || !expiryMatches) {
    throw new PrivateOfferPersistenceError(
      "STALE",
      "This send was already used for a different private offer. Review the current draft and try again.",
    );
  }
}

async function resolveRecipientForUpdate(
  tx: TransactionDb,
  input: { producerId: string; recipient: PrivateOfferRecipient; now: Date },
) {
  if (input.recipient.kind === "existing") {
    const [contact] = await tx
      .select({
        id: clientContacts.id,
        producerId: clientContacts.producerId,
        name: clientContacts.name,
        email: clientContacts.email,
        clerkUserId: clientContacts.clerkUserId,
      })
      .from(clientContacts)
      .where(
        and(
          eq(clientContacts.id, input.recipient.clientContactId),
          eq(clientContacts.producerId, input.producerId),
          isNull(clientContacts.producerArchivedAt),
        ),
      )
      .limit(1)
      .for("update");
    if (!contact) notFound();
    return contact;
  }

  const email = normalizeRecipientEmail(input.recipient.email);
  const emailHash = emailHashFor(email);
  const name = input.recipient.name.trim();
  const [inserted] = await tx
    .insert(clientContacts)
    .values({
      producerId: input.producerId,
      email,
      emailHash,
      name,
      firstSeenAt: input.now,
      lastSeenAt: input.now,
    })
    .onConflictDoNothing({
      target: [clientContacts.producerId, clientContacts.emailHash],
    })
    .returning({
      id: clientContacts.id,
      producerId: clientContacts.producerId,
      name: clientContacts.name,
      email: clientContacts.email,
      clerkUserId: clientContacts.clerkUserId,
    });
  if (inserted) return inserted;

  const [existing] = await tx
    .select({
      id: clientContacts.id,
      producerId: clientContacts.producerId,
      name: clientContacts.name,
      email: clientContacts.email,
      clerkUserId: clientContacts.clerkUserId,
    })
    .from(clientContacts)
    .where(
      and(
        eq(clientContacts.producerId, input.producerId),
        eq(clientContacts.emailHash, emailHash),
        isNull(clientContacts.producerArchivedAt),
      ),
    )
    .limit(1)
    .for("update");
  if (!existing) notFound();
  return existing;
}

async function resolveTargetForShare(
  tx: TransactionDb,
  input: {
    producerId: string;
    clientContactId: string;
    target: PrivateOfferTarget;
  },
): Promise<string | null> {
  if (input.target.kind === "new") return null;
  const [target] = await tx
    .select({ id: projects.id })
    .from(projects)
    .where(
      and(
        eq(projects.id, input.target.projectId),
        eq(projects.producerId, input.producerId),
        eq(projects.clientContactId, input.clientContactId),
        inArray(projects.lifecycleStatus, ["waiting_for_payment", "active"]),
      ),
    )
    .limit(1)
    .for("share");
  if (!target) notFound();
  return target.id;
}

async function lockOpenProducer(tx: TransactionDb, producerId: string) {
  const [producer] = await tx
    .select({
      id: producers.id,
      slug: producers.slug,
      displayName: producers.displayName,
      closedAt: producers.closedAt,
    })
    .from(producers)
    .where(eq(producers.id, producerId))
    .limit(1)
    .for("update");
  if (!producer || producer.closedAt !== null) unavailable();
  return producer;
}

export async function createPrivateOffer(
  db: Db,
  input: {
    offerId: string;
    sourceProductId?: string;
    producerId: string;
    recipient: PrivateOfferRecipient;
    target: PrivateOfferTarget;
    terms: PrivateOfferInput;
    now: Date;
    expiresAt?: Date;
  },
) {
  const snapshot = buildPrivateOfferSnapshot(input.terms);
  const expiresAt = input.expiresAt ?? defaultPrivateOfferExpiry(input.now);
  assertPrivateOfferActionAllowed({
    status: "draft",
    expiresAt,
    action: "send",
    now: input.now,
  });

  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(privateOffers)
      .where(eq(privateOffers.id, input.offerId))
      .limit(1);
    if (existing) {
      assertExactPrivateOfferReplay(existing, {
        producerId: input.producerId,
        ...(input.sourceProductId ? { sourceProductId: input.sourceProductId } : {}),
        recipient: input.recipient,
        target: input.target,
        snapshot,
        expiresAt,
      });
      return { created: false as const, offer: existing };
    }

    // An in-flight request may have passed producerProcedure before closure.
    // Serialize all new recipient/offer writes with the authoritative closure
    // row; the exact committed replay above remains available after closure.
    const producer = await lockOpenProducer(tx, input.producerId);

    let sourceProductId: string | null = null;
    if (input.sourceProductId) {
      const [sourceProduct] = await tx
        .select({ id: products.id })
        .from(products)
        .where(
          and(
            eq(products.id, input.sourceProductId),
            eq(products.producerId, input.producerId),
            isNull(products.archivedAt),
          ),
        )
        .limit(1)
        .for("share");
      if (!sourceProduct) notFound();
      sourceProductId = sourceProduct.id;
    }

    const recipient = await resolveRecipientForUpdate(tx, input);
    const targetProjectId = await resolveTargetForShare(tx, {
      producerId: input.producerId,
      clientContactId: recipient.id,
      target: input.target,
    });
    const [offer] = await tx
      .insert(privateOffers)
      .values({
        id: input.offerId,
        producerId: input.producerId,
        clientContactId: recipient.id,
        recipientEmail: recipient.email,
        recipientEmailHash: emailHashFor(recipient.email),
        targetProjectId,
        productId: sourceProductId,
        status: "sent",
        commercialDraft: snapshot,
        expiresAt,
        createdAt: input.now,
        updatedAt: input.now,
      })
      .onConflictDoNothing({ target: privateOffers.id })
      .returning();
    if (offer) return { created: true as const, offer, recipient, producer };

    // A concurrent retry can win the primary-key insert after the initial
    // lookup. PostgreSQL waits for that transaction at ON CONFLICT, so this
    // statement observes the committed winner. Never return another
    // producer's row even if they supplied the same client-generated UUID.
    const [replayed] = await tx
      .select()
      .from(privateOffers)
      .where(eq(privateOffers.id, input.offerId))
      .limit(1);
    if (!replayed) throw new PrivateOfferPersistenceError("INTEGRITY");
    assertExactPrivateOfferReplay(replayed, {
      producerId: input.producerId,
      ...(input.sourceProductId ? { sourceProductId: input.sourceProductId } : {}),
      recipient: input.recipient,
      target: input.target,
      snapshot,
      expiresAt,
    });
    return { created: false as const, offer: replayed };
  });
}

export async function expireProducerPrivateOffers(
  db: Db,
  input: { producerId: string; now: Date },
): Promise<void> {
  await db
    .update(privateOffers)
    .set({ status: "expired", updatedAt: input.now })
    .where(
      and(
        eq(privateOffers.producerId, input.producerId),
        eq(privateOffers.status, "sent"),
        lte(privateOffers.expiresAt, input.now),
      ),
    );
}

export async function listProducerPrivateOffers(db: Db, input: { producerId: string; now: Date }) {
  await expireProducerPrivateOffers(db, input);
  return db
    .select({
      id: privateOffers.id,
      status: privateOffers.status,
      commercialDraft: privateOffers.commercialDraft,
      expiresAt: privateOffers.expiresAt,
      acceptedAt: privateOffers.acceptedAt,
      createdAt: privateOffers.createdAt,
      updatedAt: privateOffers.updatedAt,
      clientContactId: privateOffers.clientContactId,
      recipientName: clientContacts.name,
      recipientEmail: privateOffers.recipientEmail,
      targetProjectId: privateOffers.targetProjectId,
      targetProjectTitle: projects.title,
      purchaseId: purchases.id,
      purchaseLifecycleStatus: purchases.lifecycleStatus,
    })
    .from(privateOffers)
    .innerJoin(
      clientContacts,
      and(
        eq(clientContacts.id, privateOffers.clientContactId),
        eq(clientContacts.producerId, privateOffers.producerId),
      ),
    )
    .leftJoin(
      projects,
      and(
        eq(projects.id, privateOffers.targetProjectId),
        eq(projects.producerId, privateOffers.producerId),
        eq(projects.clientContactId, privateOffers.clientContactId),
      ),
    )
    .leftJoin(purchases, eq(purchases.privateOfferId, privateOffers.id))
    .where(eq(privateOffers.producerId, input.producerId))
    .orderBy(desc(privateOffers.createdAt));
}

export async function listPrivateOfferRecipients(db: Db, producerId: string) {
  const [contacts, projectRows] = await Promise.all([
    db
      .select({
        id: clientContacts.id,
        name: clientContacts.name,
        email: clientContacts.email,
      })
      .from(clientContacts)
      .where(
        and(eq(clientContacts.producerId, producerId), isNull(clientContacts.producerArchivedAt)),
      )
      .orderBy(clientContacts.name),
    db
      .select({
        id: projects.id,
        title: projects.title,
        clientContactId: projects.clientContactId,
        lifecycleStatus: projects.lifecycleStatus,
      })
      .from(projects)
      .where(
        and(
          eq(projects.producerId, producerId),
          inArray(projects.lifecycleStatus, ["waiting_for_payment", "active"]),
        ),
      )
      .orderBy(projects.title),
  ]);
  return contacts.map((contact) => ({
    ...contact,
    projects: projectRows.filter((project) => project.clientContactId === contact.id),
  }));
}

export async function listPrivateOfferProjectOptions(
  db: Db,
  input: { producerId: string; clientContactId: string },
) {
  const [projectRows, money] = await Promise.all([
    db
      .select({
        id: projects.id,
        title: projects.title,
        createdAt: projects.createdAt,
        lifecycleStatus: projects.lifecycleStatus,
        songCount: sql<number>`count(${projectTracks.id})::int`.mapWith(Number),
      })
      .from(projects)
      .leftJoin(projectTracks, eq(projectTracks.projectId, projects.id))
      .where(
        and(
          eq(projects.producerId, input.producerId),
          eq(projects.clientContactId, input.clientContactId),
          inArray(projects.lifecycleStatus, ["waiting_for_payment", "active"]),
        ),
      )
      .groupBy(projects.id)
      .orderBy(desc(projects.createdAt), desc(projects.id)),
    getClientMoneyLedger(clientMoneyRepository(db), input),
  ]);
  const moneyByProjectId = new Map(money.projects.map((project) => [project.id, project]));

  return projectRows.map((project) => {
    if (project.lifecycleStatus !== "waiting_for_payment" && project.lifecycleStatus !== "active") {
      throw new PrivateOfferPersistenceError("INTEGRITY");
    }
    return {
      ...project,
      lifecycleStatus: project.lifecycleStatus,
      balances:
        moneyByProjectId.get(project.id)?.totals.map((total) => ({
          currency: total.currency,
          remainingCents: total.remainingCents,
        })) ?? [],
    };
  });
}

async function lockProducerOffer(
  tx: TransactionDb,
  input: { producerId: string; offerId: string },
) {
  const [offer] = await tx
    .select()
    .from(privateOffers)
    .where(and(eq(privateOffers.id, input.offerId), eq(privateOffers.producerId, input.producerId)))
    .limit(1)
    .for("update");
  if (!offer) notFound();
  return offer;
}

function sameInstant(left: Date, right: Date): boolean {
  return left.getTime() === right.getTime();
}

export async function updatePrivateOffer(
  db: Db,
  input: {
    producerId: string;
    offerId: string;
    expectedUpdatedAt: Date;
    target: PrivateOfferTarget;
    terms: PrivateOfferInput;
    expiresAt: Date;
    now: Date;
  },
) {
  const snapshot = buildPrivateOfferSnapshot(input.terms);
  assertPrivateOfferActionAllowed({
    status: "draft",
    expiresAt: input.expiresAt,
    action: "send",
    now: input.now,
  });
  const outcome = await db.transaction(async (tx) => {
    const offer = await lockProducerOffer(tx, input);
    await lockOpenProducer(tx, offer.producerId);
    if (isPrivateOfferExpired(offer.expiresAt, input.now) && offer.status === "sent") {
      await tx
        .update(privateOffers)
        .set({ status: "expired", updatedAt: input.now })
        .where(and(eq(privateOffers.id, offer.id), eq(privateOffers.status, "sent")));
      return { kind: "expired" as const };
    }
    assertPrivateOfferActionAllowed({
      status: offer.status as PrivateOfferStatus,
      expiresAt: offer.expiresAt,
      action: "edit",
      now: input.now,
    });
    if (!sameInstant(offer.updatedAt, input.expectedUpdatedAt)) {
      throw new PrivateOfferPersistenceError(
        "STALE",
        "This offer changed in another tab. Refresh before editing it.",
      );
    }
    const targetProjectId = await resolveTargetForShare(tx, {
      producerId: offer.producerId,
      clientContactId: offer.clientContactId,
      target: input.target,
    });
    const [updated] = await tx
      .update(privateOffers)
      .set({
        targetProjectId,
        commercialDraft: snapshot,
        expiresAt: input.expiresAt,
        updatedAt: input.now,
      })
      .where(
        and(
          eq(privateOffers.id, offer.id),
          eq(privateOffers.producerId, offer.producerId),
          eq(privateOffers.clientContactId, offer.clientContactId),
          eq(privateOffers.status, "sent"),
        ),
      )
      .returning();
    if (!updated) unavailable();
    return { kind: "updated" as const, offer: updated };
  });
  if (outcome.kind === "expired") unavailable();
  return outcome.offer;
}

export async function cancelPrivateOffer(
  db: Db,
  input: { producerId: string; offerId: string; now: Date },
) {
  const outcome = await db.transaction(async (tx) => {
    const offer = await lockProducerOffer(tx, input);
    if (offer.status === "canceled") return { kind: "canceled" as const, changed: false };
    if (isPrivateOfferExpired(offer.expiresAt, input.now) && offer.status === "sent") {
      await tx
        .update(privateOffers)
        .set({ status: "expired", updatedAt: input.now })
        .where(and(eq(privateOffers.id, offer.id), eq(privateOffers.status, "sent")));
      return { kind: "expired" as const };
    }
    assertPrivateOfferActionAllowed({
      status: offer.status as PrivateOfferStatus,
      expiresAt: offer.expiresAt,
      action: "cancel",
      now: input.now,
    });
    const [updated] = await tx
      .update(privateOffers)
      .set({ status: "canceled", updatedAt: input.now })
      .where(
        and(
          eq(privateOffers.id, offer.id),
          eq(privateOffers.producerId, offer.producerId),
          inArray(privateOffers.status, ["draft", "sent"]),
        ),
      )
      .returning({ id: privateOffers.id });
    if (!updated) unavailable();
    return { kind: "canceled" as const, changed: true };
  });
  if (outcome.kind === "expired") unavailable();
  return { changed: outcome.changed };
}

function artistOfferSelection() {
  return {
    id: privateOffers.id,
    producerId: privateOffers.producerId,
    producerName: producers.displayName,
    producerSlug: producers.slug,
    clientContactId: privateOffers.clientContactId,
    targetProjectId: privateOffers.targetProjectId,
    targetProjectTitle: projects.title,
    status: privateOffers.status,
    commercialDraft: privateOffers.commercialDraft,
    expiresAt: privateOffers.expiresAt,
    createdAt: privateOffers.createdAt,
    updatedAt: privateOffers.updatedAt,
  } as const;
}

export async function listArtistPrivateOffers(
  db: Db,
  input: { clerkUserId: string; verifiedEmailHashes: string[]; producerId?: string; now: Date },
) {
  if (input.verifiedEmailHashes.length === 0) unavailable();
  const rows = await db
    .select(artistOfferSelection())
    .from(privateOffers)
    .innerJoin(
      clientContacts,
      and(
        eq(clientContacts.id, privateOffers.clientContactId),
        eq(clientContacts.producerId, privateOffers.producerId),
        eq(clientContacts.clerkUserId, input.clerkUserId),
        inArray(privateOffers.recipientEmailHash, input.verifiedEmailHashes),
        isNull(clientContacts.archivedAt),
      ),
    )
    .innerJoin(producers, eq(producers.id, privateOffers.producerId))
    .leftJoin(
      projects,
      and(
        eq(projects.id, privateOffers.targetProjectId),
        eq(projects.producerId, privateOffers.producerId),
        eq(projects.clientContactId, privateOffers.clientContactId),
      ),
    )
    .where(
      and(
        eq(privateOffers.status, "sent"),
        gt(privateOffers.expiresAt, input.now),
        isNull(producers.closedAt),
        input.producerId ? eq(privateOffers.producerId, input.producerId) : undefined,
      ),
    )
    .orderBy(desc(privateOffers.createdAt));
  return rows.filter((row) => !isPrivateOfferExpired(row.expiresAt, input.now));
}

export async function getArtistPrivateOffer(
  db: Db,
  input: { clerkUserId: string; verifiedEmailHashes: string[]; offerId: string; now: Date },
) {
  if (input.verifiedEmailHashes.length === 0) unavailable();
  const [row] = await db
    .select(artistOfferSelection())
    .from(privateOffers)
    .innerJoin(
      clientContacts,
      and(
        eq(clientContacts.id, privateOffers.clientContactId),
        eq(clientContacts.producerId, privateOffers.producerId),
        eq(clientContacts.clerkUserId, input.clerkUserId),
        inArray(privateOffers.recipientEmailHash, input.verifiedEmailHashes),
        isNull(clientContacts.archivedAt),
      ),
    )
    .innerJoin(producers, eq(producers.id, privateOffers.producerId))
    .leftJoin(
      projects,
      and(
        eq(projects.id, privateOffers.targetProjectId),
        eq(projects.producerId, privateOffers.producerId),
        eq(projects.clientContactId, privateOffers.clientContactId),
      ),
    )
    .where(
      and(
        eq(privateOffers.id, input.offerId),
        eq(privateOffers.status, "sent"),
        gt(privateOffers.expiresAt, input.now),
        isNull(producers.closedAt),
      ),
    )
    .limit(1);
  if (!row || isPrivateOfferExpired(row.expiresAt, input.now)) notFound();
  return row;
}

async function lockArtistOffer(
  tx: TransactionDb,
  input: { clerkUserId: string; verifiedEmailHashes: string[]; offerId: string },
) {
  if (input.verifiedEmailHashes.length === 0) unavailable();
  const [row] = await tx
    .select({
      offer: privateOffers,
      recipientName: clientContacts.name,
      recipientEmail: privateOffers.recipientEmail,
      producerArchivedAt: clientContacts.producerArchivedAt,
      producerClosedAt: producers.closedAt,
    })
    .from(privateOffers)
    .innerJoin(
      clientContacts,
      and(
        eq(clientContacts.id, privateOffers.clientContactId),
        eq(clientContacts.producerId, privateOffers.producerId),
        eq(clientContacts.clerkUserId, input.clerkUserId),
        inArray(privateOffers.recipientEmailHash, input.verifiedEmailHashes),
        isNull(clientContacts.archivedAt),
      ),
    )
    .innerJoin(producers, eq(producers.id, privateOffers.producerId))
    .where(eq(privateOffers.id, input.offerId))
    .limit(1)
    .for("update");
  if (!row) notFound();
  return row;
}

export async function rejectPrivateOffer(
  db: Db,
  input: { clerkUserId: string; verifiedEmailHashes: string[]; offerId: string; now: Date },
) {
  const outcome = await db.transaction(async (tx) => {
    const { offer, producerClosedAt } = await lockArtistOffer(tx, input);
    if (producerClosedAt !== null) unavailable();
    if (offer.status === "declined") return { kind: "declined" as const, changed: false };
    if (isPrivateOfferExpired(offer.expiresAt, input.now) && offer.status === "sent") {
      await tx
        .update(privateOffers)
        .set({ status: "expired", updatedAt: input.now })
        .where(and(eq(privateOffers.id, offer.id), eq(privateOffers.status, "sent")));
      return { kind: "expired" as const };
    }
    assertPrivateOfferActionAllowed({
      status: offer.status as PrivateOfferStatus,
      expiresAt: offer.expiresAt,
      action: "reject",
      now: input.now,
    });
    const [updated] = await tx
      .update(privateOffers)
      .set({ status: "declined", updatedAt: input.now })
      .where(
        and(
          eq(privateOffers.id, offer.id),
          eq(privateOffers.producerId, offer.producerId),
          eq(privateOffers.clientContactId, offer.clientContactId),
          eq(privateOffers.status, "sent"),
        ),
      )
      .returning({ id: privateOffers.id });
    if (!updated) unavailable();
    return { kind: "declined" as const, changed: true };
  });
  if (outcome.kind === "expired") unavailable();
  return { changed: outcome.changed };
}

function assertAcceptanceReplay(
  row: {
    acceptedByClerkUserId: string;
    commercialSnapshot: PurchaseCommercialSnapshot;
  },
  input: { clerkUserId: string; selectedPaymentPlan: PaymentPlan | null },
): void {
  if (row.acceptedByClerkUserId !== input.clerkUserId) unavailable();
  const storedKey =
    row.commercialSnapshot.selectedPaymentPlan === null
      ? null
      : privateOfferPaymentPlanKey(row.commercialSnapshot.selectedPaymentPlan);
  const requestedKey =
    input.selectedPaymentPlan === null
      ? null
      : privateOfferPaymentPlanKey(input.selectedPaymentPlan);
  if (storedKey !== requestedKey) unavailable();
}

export async function acceptPrivateOffer(
  db: Db,
  input: {
    clerkUserId: string;
    verifiedEmailHashes: string[];
    offerId: string;
    expectedUpdatedAt: Date;
    expectedTargetProjectTitle: string | null;
    selectedPaymentPlan: PaymentPlan | null;
    agreementAccepted: boolean;
    now: Date;
  },
) {
  if (!input.agreementAccepted) unavailable();
  const outcome = await db.transaction(async (tx) => {
    const { offer, recipientName, recipientEmail, producerArchivedAt, producerClosedAt } =
      await lockArtistOffer(tx, input);

    if (offer.status === "accepted") {
      const [existing] = await tx
        .select({
          purchaseId: purchases.id,
          projectId: purchases.projectId,
          producerId: purchases.producerId,
          lifecycleStatus: purchases.lifecycleStatus,
          commercialSnapshot: purchases.commercialSnapshot,
          acceptedByClerkUserId: purchaseAcceptances.acceptedByClerkUserId,
        })
        .from(purchases)
        .innerJoin(purchaseAcceptances, eq(purchaseAcceptances.purchaseId, purchases.id))
        .where(eq(purchases.privateOfferId, offer.id))
        .limit(1);
      if (!existing) throw new PrivateOfferPersistenceError("INTEGRITY");
      assertAcceptanceReplay(existing, input);
      return {
        kind: "accepted" as const,
        ...existing,
        artistName: recipientName,
        created: false,
      };
    }

    // Producer archive retains offer history and an already-accepted replay,
    // but it must not create new commercial work. The joined FOR UPDATE lock
    // serializes this check with archiveClient's update of the same contact.
    if (producerArchivedAt !== null) unavailable();
    if (producerClosedAt !== null) unavailable();

    if (isPrivateOfferExpired(offer.expiresAt, input.now) && offer.status === "sent") {
      await tx
        .update(privateOffers)
        .set({ status: "expired", updatedAt: input.now })
        .where(and(eq(privateOffers.id, offer.id), eq(privateOffers.status, "sent")));
      return { kind: "expired" as const };
    }
    assertPrivateOfferActionAllowed({
      status: offer.status as PrivateOfferStatus,
      expiresAt: offer.expiresAt,
      action: "accept",
      now: input.now,
    });
    if (!sameInstant(offer.updatedAt, input.expectedUpdatedAt)) {
      throw new PrivateOfferPersistenceError(
        "STALE",
        "This offer changed. Review the exact terms again before accepting.",
      );
    }

    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`artist-purchase:${input.clerkUserId}:${offer.producerId}`}, 0))`,
    );
    const activePurchase = await loadArtistPurchaseGuard(tx, {
      clerkUserId: input.clerkUserId,
      producerId: offer.producerId,
    });
    if (activePurchase.blocked) {
      throw new PrivateOfferPersistenceError(
        "ACTIVE_PURCHASE",
        "Finish the current purchase with this studio before accepting another offer.",
      );
    }

    let target: { kind: "new" } | { kind: "existing"; projectId: string; projectName: string };
    let projectId = offer.targetProjectId;
    if (projectId === null) {
      if (input.expectedTargetProjectTitle !== null) {
        throw new PrivateOfferPersistenceError(
          "STALE",
          "This project target changed. Review the exact offer again before accepting.",
        );
      }
      target = { kind: "new" };
      const [project] = await tx
        .insert(projects)
        .values({
          producerId: offer.producerId,
          clientContactId: offer.clientContactId,
          title: offer.commercialDraft.productOrOfferName,
          lifecycleStatus: "waiting_for_payment",
          lifecycleChangedAt: input.now,
          clientName: recipientName,
          clientEmail: recipientEmail,
          artistName: recipientName,
          artistEmail: recipientEmail,
          updatedAt: input.now,
        })
        .returning({ id: projects.id });
      if (!project) throw new PrivateOfferPersistenceError("INTEGRITY");
      projectId = project.id;
      const [targeted] = await tx
        .update(privateOffers)
        .set({ targetProjectId: projectId })
        .where(
          and(
            eq(privateOffers.id, offer.id),
            eq(privateOffers.status, "sent"),
            isNull(privateOffers.targetProjectId),
          ),
        )
        .returning({ id: privateOffers.id });
      if (!targeted) unavailable();
    } else {
      const [project] = await tx
        .select({ id: projects.id, title: projects.title })
        .from(projects)
        .where(
          and(
            eq(projects.id, projectId),
            eq(projects.producerId, offer.producerId),
            eq(projects.clientContactId, offer.clientContactId),
            inArray(projects.lifecycleStatus, ["waiting_for_payment", "active"]),
          ),
        )
        .limit(1)
        .for("update");
      if (!project) notFound();
      if (project.title !== input.expectedTargetProjectTitle) {
        throw new PrivateOfferPersistenceError(
          "STALE",
          "This project target changed. Review the exact offer again before accepting.",
        );
      }
      target = { kind: "existing", projectId: project.id, projectName: project.title };
    }

    const finalized = finalizePrivateOfferSnapshot({
      draft: offer.commercialDraft,
      selectedPaymentPlan: input.selectedPaymentPlan,
      target,
    });
    const result = await acceptPurchase(purchaseRepositoryForTransaction(tx), {
      producerId: offer.producerId,
      projectId,
      clientContactId: offer.clientContactId,
      source: {
        kind: "private_offer",
        productId: offer.productId,
        privateOfferId: offer.id,
        purchaseRequestId: null,
      },
      acceptedByClerkUserId: input.clerkUserId,
      operationKey: `private-offer:${offer.id}:accept:v1`,
      totalCents: finalized.snapshot.totalCents,
      plan: input.selectedPaymentPlan,
      commercialSnapshot: finalized.snapshot,
      acceptedAt: input.now,
    });

    const [accepted] = await tx
      .update(privateOffers)
      .set({
        status: "accepted",
        acceptedAt: input.now,
        updatedAt: input.now,
      })
      .where(
        and(
          eq(privateOffers.id, offer.id),
          eq(privateOffers.producerId, offer.producerId),
          eq(privateOffers.clientContactId, offer.clientContactId),
          eq(privateOffers.targetProjectId, projectId),
          eq(privateOffers.status, "sent"),
        ),
      )
      .returning({ id: privateOffers.id });
    if (!accepted) unavailable();
    return {
      kind: "accepted" as const,
      purchaseId: result.purchase.id,
      projectId,
      producerId: offer.producerId,
      lifecycleStatus: result.purchase.lifecycleStatus,
      commercialSnapshot: finalized.snapshot,
      acceptedByClerkUserId: input.clerkUserId,
      artistName: recipientName,
      created: result.created,
    };
  });
  if (outcome.kind === "expired") unavailable();
  return outcome;
}

export async function notifyProducerOfPrivateOfferAcceptance(
  db: Db,
  input: {
    producerId: string;
    purchaseId: string;
    artistName: string;
    offerName: string;
  },
): Promise<void> {
  await db.insert(notifications).values({
    producerId: input.producerId,
    purchaseId: input.purchaseId,
    kind: "agreement_accepted",
    title: `${input.artistName} accepted the agreement`,
    body: input.offerName,
  });
}

export function privateOfferSnapshotDigest(snapshot: PurchaseCommercialSnapshot): string {
  return digestCommercialSnapshot(snapshot);
}
