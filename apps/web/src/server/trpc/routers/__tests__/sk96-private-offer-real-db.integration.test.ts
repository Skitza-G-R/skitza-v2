import { randomUUID } from "node:crypto";

import {
  and,
  clientContacts,
  createDb,
  eq,
  inArray,
  paymentProofs,
  privateOffers,
  producers,
  products,
  projects,
  purchaseAcceptances,
  purchaseInstallments,
  purchasePayments,
  purchases,
  purchaseSessionAllowances,
  sql,
  type Db,
} from "@skitza/db";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { emailHashFor } from "~/server/artist/identity";
import { connectVerifiedArtistToProducer } from "~/server/contacts/connect-artist";
import { clientManagementRepository } from "~/server/domain/client-management/db";
import { archiveClient } from "~/server/domain/client-management/service";
import { projectLifecycleRepository } from "~/server/domain/project-lifecycle/db";
import { cancelProject, completeProject } from "~/server/domain/project-lifecycle/service";
import {
  acceptPrivateOffer,
  cancelPrivateOffer,
  createPrivateOffer,
  getArtistPrivateOffer,
  PrivateOfferPersistenceError,
  rejectPrivateOffer,
  updatePrivateOffer,
} from "~/server/domain/private-offers/db";
import type { PrivateOfferInput } from "~/server/domain/private-offers/service";
import { approvedPurchaseRealDbTarget } from "./purchase-real-db-target-gate";

const approvedTarget = approvedPurchaseRealDbTarget(process.env);
const describeWithSafeDatabase = approvedTarget ? describe : describe.skip;
if (approvedTarget) vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

async function safely<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof PrivateOfferPersistenceError) throw error;
    throw new Error("SK-96 isolated database operation failed");
  }
}

async function offerError(operation: Promise<unknown>): Promise<PrivateOfferPersistenceError> {
  try {
    await operation;
  } catch (error) {
    expect(error).toBeInstanceOf(PrivateOfferPersistenceError);
    return error as PrivateOfferPersistenceError;
  }
  throw new Error("Expected PrivateOfferPersistenceError");
}

describeWithSafeDatabase("SK-96 private offers — isolated disposable Postgres", () => {
  const suffix = randomUUID();
  const artistClerkUserId = `sk96-artist-${suffix}`;
  const otherArtistClerkUserId = `sk96-other-artist-${suffix}`;
  const artistEmail = `sk96-${suffix}@example.invalid`;
  const otherArtistEmail = `sk96-other-${suffix}@example.invalid`;
  const artistEmailHash = emailHashFor(artistEmail);
  const otherArtistEmailHash = emailHashFor(otherArtistEmail);
  const artistVerifiedEmailHashes = [artistEmailHash];
  const otherArtistVerifiedEmailHashes = [otherArtistEmailHash];
  let db: Db | undefined;
  let producerId = "";
  let clientContactId = "";
  let otherClientContactId = "";

  function activeDb(): Db {
    if (!db) throw new Error("SK-96 isolated database was not initialized");
    return db;
  }

  function terms(
    input: { zero?: boolean; name?: string; session?: boolean } = {},
  ): PrivateOfferInput {
    const zero = input.zero ?? false;
    return {
      name: input.name ?? (zero ? "SK-96 royalty-only offer" : "SK-96 private mix"),
      tagline: zero ? "Royalty only" : "Private exact terms",
      service: "Production",
      deliverables: ["Stereo WAV", "Stems"],
      cashPriceCents: zero ? 0 : 80_000,
      currency: "ILS",
      taxMode: "tax_free",
      taxRatePct: 18,
      includedSongSpaces: 2,
      session: input.session
        ? {
            limit: { kind: "fixed", count: 2 },
            durationMin: 90,
            locationType: "studio",
            bufferMinutes: 15,
            minLeadHours: 24,
          }
        : null,
      revisionRule: { kind: "fixed", count: 2 },
      royaltyTerms: {
        master: zero ? { mode: "percentage", bps: 1_000 } : { mode: "none" },
        composition: { mode: "none" },
      },
      rights: ["Artist controls release timing."],
      enabledPaymentPlans: zero ? [] : [{ kind: "full" }],
      agreementText: "SK-96 exact private-offer agreement.",
    };
  }

  async function createProject(input: {
    title: string;
    ownerClientContactId?: string;
  }): Promise<string> {
    const ownerClientContactId = input.ownerClientContactId ?? clientContactId;
    const [row] = await safely(() =>
      activeDb()
        .insert(projects)
        .values({
          producerId,
          clientContactId: ownerClientContactId,
          title: input.title,
          artistName:
            ownerClientContactId === clientContactId ? "SK-96 Artist" : "SK-96 Other Artist",
          artistEmail: ownerClientContactId === clientContactId ? artistEmail : otherArtistEmail,
        })
        .returning({ id: projects.id }),
    );
    if (!row) throw new Error("SK-96 project fixture was not created");
    return row.id;
  }

  async function createArchiveAcceptanceFixture(label: string, zero = false) {
    const fixtureSuffix = randomUUID();
    const fixtureProducerClerkId = `sk219-archive-producer-${fixtureSuffix}`;
    const fixtureArtistClerkId = `sk219-archive-artist-${fixtureSuffix}`;
    const fixtureArtistEmail = `sk219-archive-${fixtureSuffix}@example.invalid`;
    const fixtureArtistEmailHash = emailHashFor(fixtureArtistEmail);
    const [fixtureProducer] = await safely(() =>
      activeDb()
        .insert(producers)
        .values({
          clerkUserId: fixtureProducerClerkId,
          email: `sk219-archive-producer-${fixtureSuffix}@example.invalid`,
          slug: `sk219-archive-${fixtureSuffix}`,
          displayName: `SK-219 ${label}`,
        })
        .returning({ id: producers.id }),
    );
    if (!fixtureProducer) throw new Error("SK-219 archive fixture producer was not created");
    const [fixtureClient] = await safely(() =>
      activeDb()
        .insert(clientContacts)
        .values({
          producerId: fixtureProducer.id,
          emailHash: fixtureArtistEmailHash,
          email: fixtureArtistEmail,
          name: `SK-219 ${label} Artist`,
          clerkUserId: fixtureArtistClerkId,
        })
        .returning({ id: clientContacts.id }),
    );
    if (!fixtureClient) throw new Error("SK-219 archive fixture client was not created");
    const now = new Date();
    const created = await createPrivateOffer(activeDb(), {
      offerId: randomUUID(),
      producerId: fixtureProducer.id,
      recipient: { kind: "existing", clientContactId: fixtureClient.id },
      target: { kind: "new" },
      terms: terms({ name: `SK-219 ${label} offer`, zero }),
      now,
    });
    return {
      producerId: fixtureProducer.id,
      clientContactId: fixtureClient.id,
      artistClerkUserId: fixtureArtistClerkId,
      verifiedEmailHashes: [fixtureArtistEmailHash],
      offer: created.offer,
    };
  }

  async function archiveAcceptanceState(input: {
    producerId: string;
    clientContactId: string;
    offerId: string;
  }) {
    const [client] = await safely(() =>
      activeDb()
        .select({ producerArchivedAt: clientContacts.producerArchivedAt })
        .from(clientContacts)
        .where(eq(clientContacts.id, input.clientContactId))
        .limit(1),
    );
    const [offer] = await safely(() =>
      activeDb()
        .select({ status: privateOffers.status })
        .from(privateOffers)
        .where(eq(privateOffers.id, input.offerId))
        .limit(1),
    );
    const purchaseRows = await safely(() =>
      activeDb()
        .select({ id: purchases.id })
        .from(purchases)
        .where(eq(purchases.privateOfferId, input.offerId)),
    );
    const projectRows = await safely(() =>
      activeDb()
        .select({ id: projects.id, lifecycleStatus: projects.lifecycleStatus })
        .from(projects)
        .where(
          and(
            eq(projects.producerId, input.producerId),
            eq(projects.clientContactId, input.clientContactId),
          ),
        ),
    );
    return { client, offer, purchaseRows, projectRows };
  }

  beforeAll(async () => {
    const target = approvedTarget;
    if (!target) throw new Error("SK-96 isolated database opt-in was not complete");
    db = createDb(target.targetDatabaseUrl);

    const marker = await safely(() =>
      activeDb().execute<{
        databaseName: string;
        constraintCount: number;
        triggerCount: number;
        recipientColumnCount: number;
        recipientTriggerCount: number;
      }>(sql`
        select
          current_database()::text as "databaseName",
          (
            select count(*)::int from pg_constraint
            where connamespace = 'public'::regnamespace
              and conname in (
                'private_offers_client_producer_fk',
                'private_offers_project_owner_fk',
                'purchases_private_offer_owner_fk',
                'purchases_private_offer_project_owner_fk'
              )
          ) as "constraintCount",
          (
            select count(*)::int from pg_trigger
            where tgname = 'private_offers_protect_purchase_source'
              and tgenabled = 'O' and not tgisinternal
          ) as "triggerCount",
          (
            select count(*)::int from information_schema.columns
            where table_schema = 'public' and table_name = 'private_offers'
              and column_name in ('recipient_email', 'recipient_email_hash')
              and is_nullable = 'NO'
          ) as "recipientColumnCount",
          (
            select count(*)::int from pg_trigger
            where tgname = 'private_offers_recipient_identity_immutable'
              and tgenabled = 'O' and not tgisinternal
          ) as "recipientTriggerCount"
      `),
    );
    const markerRow = marker.rows[0];
    if (
      markerRow?.databaseName !== target.databaseName ||
      markerRow.constraintCount !== 4 ||
      markerRow.triggerCount !== 1 ||
      markerRow.recipientColumnCount !== 2 ||
      markerRow.recipientTriggerCount !== 1
    ) {
      throw new Error("SK-96 isolated database identity or schema marker mismatch");
    }

    const [producer] = await safely(() =>
      activeDb()
        .insert(producers)
        .values({
          clerkUserId: `sk96-producer-${suffix}`,
          email: `sk96-producer-${suffix}@example.invalid`,
          slug: `sk96-producer-${suffix}`,
          displayName: "SK-96 Studio",
        })
        .returning({ id: producers.id }),
    );
    if (!producer) throw new Error("SK-96 producer fixture was not created");
    producerId = producer.id;

    const [contact] = await safely(() =>
      activeDb()
        .insert(clientContacts)
        .values({
          producerId,
          emailHash: artistEmailHash,
          email: artistEmail,
          name: "SK-96 Artist",
          clerkUserId: artistClerkUserId,
        })
        .returning({ id: clientContacts.id }),
    );
    if (!contact) throw new Error("SK-96 contact fixture was not created");
    clientContactId = contact.id;

    const [otherContact] = await safely(() =>
      activeDb()
        .insert(clientContacts)
        .values({
          producerId,
          emailHash: otherArtistEmailHash,
          email: otherArtistEmail,
          name: "SK-96 Other Artist",
          clerkUserId: otherArtistClerkUserId,
        })
        .returning({ id: clientContacts.id }),
    );
    if (!otherContact) throw new Error("SK-96 other contact fixture was not created");
    otherClientContactId = otherContact.id;
  });

  it("uses the client-generated offer id exactly once and fails closed across producers", async () => {
    const offerId = randomUUID();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1_000);
    const offerTerms = terms({ name: "SK-219 idempotent offer" });
    const first = await createPrivateOffer(activeDb(), {
      offerId,
      producerId,
      recipient: { kind: "existing", clientContactId },
      target: { kind: "new" },
      terms: offerTerms,
      now,
      expiresAt,
    });
    expect(first.created).toBe(true);
    expect(first.offer.id).toBe(offerId);

    const replay = await createPrivateOffer(activeDb(), {
      offerId,
      producerId,
      recipient: { kind: "existing", clientContactId },
      target: { kind: "new" },
      terms: offerTerms,
      now: new Date(now.getTime() + 1_000),
      expiresAt,
    });
    expect(replay.created).toBe(false);
    expect(replay.offer.id).toBe(offerId);
    expect(replay.offer.commercialDraft.productOrOfferName).toBe("SK-219 idempotent offer");

    const changedReplay = await offerError(
      createPrivateOffer(activeDb(), {
        offerId,
        producerId,
        recipient: { kind: "existing", clientContactId },
        target: { kind: "new" },
        terms: terms({ name: "SK-219 changed retry" }),
        now: new Date(now.getTime() + 2_000),
        expiresAt,
      }),
    );
    expect(changedReplay.code).toBe("STALE");

    const [otherProducer] = await safely(() =>
      activeDb()
        .insert(producers)
        .values({
          clerkUserId: `sk219-other-producer-${suffix}`,
          email: `sk219-other-producer-${suffix}@example.invalid`,
          slug: `sk219-other-producer-${suffix}`,
          displayName: "SK-219 Other Studio",
        })
        .returning({ id: producers.id }),
    );
    if (!otherProducer) throw new Error("SK-219 other producer fixture was not created");
    const otherProducerEmail = `sk219-other-client-${suffix}@example.invalid`;
    const [otherProducerContact] = await safely(() =>
      activeDb()
        .insert(clientContacts)
        .values({
          producerId: otherProducer.id,
          email: otherProducerEmail,
          emailHash: emailHashFor(otherProducerEmail),
          name: "SK-219 Other Client",
        })
        .returning({ id: clientContacts.id }),
    );
    if (!otherProducerContact) {
      throw new Error("SK-219 other producer contact fixture was not created");
    }

    const ownershipError = await offerError(
      createPrivateOffer(activeDb(), {
        offerId,
        producerId: otherProducer.id,
        recipient: { kind: "existing", clientContactId: otherProducerContact.id },
        target: { kind: "new" },
        terms: terms({ name: "SK-219 cross-producer replay" }),
        now: new Date(now.getTime() + 2_000),
      }),
    );
    expect(ownershipError.code).toBe("UNAVAILABLE");

    const rows = await safely(() =>
      activeDb()
        .select({ id: privateOffers.id, producerId: privateOffers.producerId })
        .from(privateOffers)
        .where(eq(privateOffers.id, offerId)),
    );
    expect(rows).toEqual([{ id: offerId, producerId }]);
  });

  it("creates one row when exact retries race concurrently", async () => {
    const offerId = randomUUID();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1_000);
    const input = {
      offerId,
      producerId,
      recipient: { kind: "existing" as const, clientContactId },
      target: { kind: "new" as const },
      terms: terms({ name: "SK-219 concurrent idempotent offer" }),
      now,
      expiresAt,
    };

    const [left, right] = await Promise.all([
      createPrivateOffer(activeDb(), input),
      createPrivateOffer(activeDb(), input),
    ]);

    expect([left.created, right.created].sort()).toEqual([false, true]);
    expect([left.offer.id, right.offer.id]).toEqual([offerId, offerId]);
    const rows = await safely(() =>
      activeDb()
        .select({ id: privateOffers.id, productId: privateOffers.productId })
        .from(privateOffers)
        .where(eq(privateOffers.id, offerId)),
    );
    expect(rows).toEqual([{ id: offerId, productId: null }]);
  });

  it("rejects acceptance after the producer archives the recipient without creating work", async () => {
    const fixture = await createArchiveAcceptanceFixture("archive first");
    await archiveClient(clientManagementRepository(activeDb()), {
      producerId: fixture.producerId,
      clientId: fixture.clientContactId,
      archivedAt: new Date(),
    });

    const acceptanceError = await offerError(
      acceptPrivateOffer(activeDb(), {
        clerkUserId: fixture.artistClerkUserId,
        verifiedEmailHashes: fixture.verifiedEmailHashes,
        offerId: fixture.offer.id,
        expectedUpdatedAt: fixture.offer.updatedAt,
        expectedTargetProjectTitle: null,
        selectedPaymentPlan: { kind: "full" },
        agreementAccepted: true,
        now: new Date(),
      }),
    );
    expect(acceptanceError.code).toBe("UNAVAILABLE");

    const state = await archiveAcceptanceState({
      producerId: fixture.producerId,
      clientContactId: fixture.clientContactId,
      offerId: fixture.offer.id,
    });
    expect(state.client?.producerArchivedAt).not.toBeNull();
    expect(state.offer?.status).toBe("sent");
    expect(state.purchaseRows).toEqual([]);
    expect(state.projectRows).toEqual([]);
  });

  it("serializes acceptance against producer archive so only one commercial state wins", async () => {
    const fixture = await createArchiveAcceptanceFixture("archive race");
    const [archive, acceptance] = await Promise.allSettled([
      archiveClient(clientManagementRepository(activeDb()), {
        producerId: fixture.producerId,
        clientId: fixture.clientContactId,
        archivedAt: new Date(),
      }),
      acceptPrivateOffer(activeDb(), {
        clerkUserId: fixture.artistClerkUserId,
        verifiedEmailHashes: fixture.verifiedEmailHashes,
        offerId: fixture.offer.id,
        expectedUpdatedAt: fixture.offer.updatedAt,
        expectedTargetProjectTitle: null,
        selectedPaymentPlan: { kind: "full" },
        agreementAccepted: true,
        now: new Date(),
      }),
    ]);
    expect([archive, acceptance].filter((result) => result.status === "fulfilled")).toHaveLength(1);

    const state = await archiveAcceptanceState({
      producerId: fixture.producerId,
      clientContactId: fixture.clientContactId,
      offerId: fixture.offer.id,
    });
    if (acceptance.status === "fulfilled") {
      expect(archive.status).toBe("rejected");
      if (archive.status === "rejected") {
        expect(archive.reason).toMatchObject({ code: "BLOCKING_PROJECT" });
      }
      expect(state.client?.producerArchivedAt).toBeNull();
      expect(state.offer?.status).toBe("accepted");
      expect(state.purchaseRows).toHaveLength(1);
      expect(state.projectRows).toHaveLength(1);
    } else {
      expect(archive.status).toBe("fulfilled");
      expect(acceptance.reason).toBeInstanceOf(PrivateOfferPersistenceError);
      expect(acceptance.reason).toMatchObject({ code: "UNAVAILABLE" });
      expect(state.client?.producerArchivedAt).not.toBeNull();
      expect(state.offer?.status).toBe("sent");
      expect(state.purchaseRows).toEqual([]);
      expect(state.projectRows).toEqual([]);
    }
  });

  it("replays an already accepted offer after its completed client is later archived", async () => {
    const fixture = await createArchiveAcceptanceFixture("accepted replay after archive", true);
    const input = {
      clerkUserId: fixture.artistClerkUserId,
      verifiedEmailHashes: fixture.verifiedEmailHashes,
      offerId: fixture.offer.id,
      expectedUpdatedAt: fixture.offer.updatedAt,
      expectedTargetProjectTitle: null,
      selectedPaymentPlan: null,
      agreementAccepted: true as const,
      now: new Date(),
    };
    const accepted = await acceptPrivateOffer(activeDb(), input);
    await completeProject(projectLifecycleRepository(activeDb()), {
      producerId: fixture.producerId,
      projectId: accepted.projectId,
      completedAt: new Date(),
    });
    await archiveClient(clientManagementRepository(activeDb()), {
      producerId: fixture.producerId,
      clientId: fixture.clientContactId,
      archivedAt: new Date(),
    });

    const replay = await acceptPrivateOffer(activeDb(), input);

    expect(replay).toMatchObject({
      created: false,
      purchaseId: accepted.purchaseId,
      projectId: accepted.projectId,
      lifecycleStatus: "active",
    });
    const state = await archiveAcceptanceState({
      producerId: fixture.producerId,
      clientContactId: fixture.clientContactId,
      offerId: fixture.offer.id,
    });
    expect(state.client?.producerArchivedAt).not.toBeNull();
    expect(state.offer?.status).toBe("accepted");
    expect(state.purchaseRows).toHaveLength(1);
    expect(state.projectRows).toEqual([{ id: accepted.projectId, lifecycleStatus: "completed" }]);
  });

  it("accepts live and hidden product provenance but rejects archived and foreign products", async () => {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1_000);
    const [foreignProducer] = await safely(() =>
      activeDb()
        .insert(producers)
        .values({
          clerkUserId: `sk219-product-producer-${suffix}`,
          email: `sk219-product-producer-${suffix}@example.invalid`,
          slug: `sk219-product-producer-${suffix}`,
          displayName: "SK-219 Product Studio",
        })
        .returning({ id: producers.id }),
    );
    if (!foreignProducer) throw new Error("SK-219 foreign producer fixture was not created");

    const productRows = await safely(() =>
      activeDb()
        .insert(products)
        .values([
          {
            producerId,
            name: "SK-219 Live Product",
            durationMin: 60,
            active: true,
          },
          {
            producerId,
            name: "SK-219 Hidden Product",
            durationMin: 60,
            active: false,
          },
          {
            producerId,
            name: "SK-219 Archived Product",
            durationMin: 60,
            archivedAt: now,
          },
          {
            producerId: foreignProducer.id,
            name: "SK-219 Foreign Product",
            durationMin: 60,
          },
        ])
        .returning({ id: products.id, name: products.name }),
    );
    const productIdByName = new Map(productRows.map((product) => [product.name, product.id]));
    const liveProductId = productIdByName.get("SK-219 Live Product");
    const hiddenProductId = productIdByName.get("SK-219 Hidden Product");
    const archivedProductId = productIdByName.get("SK-219 Archived Product");
    const foreignProductId = productIdByName.get("SK-219 Foreign Product");
    if (!liveProductId || !hiddenProductId || !archivedProductId || !foreignProductId) {
      throw new Error("SK-219 product fixtures were not created");
    }

    const liveOfferId = randomUUID();
    const liveTerms = terms({ name: "SK-219 offer from live product" });
    const live = await createPrivateOffer(activeDb(), {
      offerId: liveOfferId,
      sourceProductId: liveProductId,
      producerId,
      recipient: { kind: "existing", clientContactId },
      target: { kind: "new" },
      terms: liveTerms,
      now,
      expiresAt,
    });
    const hiddenOfferId = randomUUID();
    const hidden = await createPrivateOffer(activeDb(), {
      offerId: hiddenOfferId,
      sourceProductId: hiddenProductId,
      producerId,
      recipient: { kind: "existing", clientContactId },
      target: { kind: "new" },
      terms: terms({ name: "SK-219 offer from hidden product" }),
      now,
      expiresAt,
    });
    expect(live).toMatchObject({ created: true, offer: { productId: liveProductId } });
    expect(hidden).toMatchObject({ created: true, offer: { productId: hiddenProductId } });

    const exactReplay = await createPrivateOffer(activeDb(), {
      offerId: liveOfferId,
      sourceProductId: liveProductId,
      producerId,
      recipient: { kind: "existing", clientContactId },
      target: { kind: "new" },
      terms: liveTerms,
      now: new Date(now.getTime() + 1_000),
      expiresAt,
    });
    expect(exactReplay).toMatchObject({
      created: false,
      offer: { id: liveOfferId, productId: liveProductId },
    });

    const changedSource = await offerError(
      createPrivateOffer(activeDb(), {
        offerId: liveOfferId,
        sourceProductId: hiddenProductId,
        producerId,
        recipient: { kind: "existing", clientContactId },
        target: { kind: "new" },
        terms: liveTerms,
        now: new Date(now.getTime() + 2_000),
        expiresAt,
      }),
    );
    expect(changedSource.code).toBe("STALE");

    const archivedOfferId = randomUUID();
    const archived = await offerError(
      createPrivateOffer(activeDb(), {
        offerId: archivedOfferId,
        sourceProductId: archivedProductId,
        producerId,
        recipient: { kind: "existing", clientContactId },
        target: { kind: "new" },
        terms: terms({ name: "SK-219 offer from archived product" }),
        now,
        expiresAt,
      }),
    );
    expect(archived.code).toBe("NOT_FOUND");

    const foreignOfferId = randomUUID();
    const foreign = await offerError(
      createPrivateOffer(activeDb(), {
        offerId: foreignOfferId,
        sourceProductId: foreignProductId,
        producerId,
        recipient: { kind: "existing", clientContactId },
        target: { kind: "new" },
        terms: terms({ name: "SK-219 offer from foreign product" }),
        now,
        expiresAt,
      }),
    );
    expect(foreign.code).toBe("NOT_FOUND");

    const stored = await safely(() =>
      activeDb()
        .select({ id: privateOffers.id, productId: privateOffers.productId })
        .from(privateOffers)
        .where(
          inArray(privateOffers.id, [liveOfferId, hiddenOfferId, archivedOfferId, foreignOfferId]),
        ),
    );
    expect(stored).toHaveLength(2);
    expect(stored).toEqual(
      expect.arrayContaining([
        { id: liveOfferId, productId: liveProductId },
        { id: hiddenOfferId, productId: hiddenProductId },
      ]),
    );
  });

  it("connects an offer sent to a verified secondary email", async () => {
    const now = new Date();
    const clerkUserId = `sk96-secondary-${suffix}`;
    const primaryEmail = `sk96-primary-${suffix}@example.invalid`;
    const secondaryEmail = `sk96-secondary-${suffix}@example.invalid`;
    const secondaryHash = emailHashFor(secondaryEmail);
    const [contact] = await safely(() =>
      activeDb()
        .insert(clientContacts)
        .values({
          producerId,
          email: secondaryEmail,
          emailHash: secondaryHash,
          name: "SK-96 Secondary Artist",
        })
        .returning({ id: clientContacts.id }),
    );
    if (!contact) throw new Error("SK-96 secondary contact was not created");
    const created = await createPrivateOffer(activeDb(), {
      offerId: randomUUID(),
      producerId,
      recipient: { kind: "existing", clientContactId: contact.id },
      target: { kind: "new" },
      terms: terms({ name: "SK-96 secondary-email offer" }),
      now,
    });

    await connectVerifiedArtistToProducer(activeDb(), {
      producerId,
      primaryEmail,
      verifiedEmailHashes: [emailHashFor(primaryEmail), secondaryHash],
      name: "SK-96 Secondary Artist",
      clerkUserId,
      now,
    });

    await expect(
      getArtistPrivateOffer(activeDb(), {
        clerkUserId,
        verifiedEmailHashes: [emailHashFor(primaryEmail), secondaryHash],
        offerId: created.offer.id,
        now,
      }),
    ).resolves.toMatchObject({ id: created.offer.id });
    const matchingContacts = await safely(() =>
      activeDb()
        .select({ id: clientContacts.id, clerkUserId: clientContacts.clerkUserId })
        .from(clientContacts)
        .where(
          and(
            eq(clientContacts.producerId, producerId),
            inArray(clientContacts.emailHash, [emailHashFor(primaryEmail), secondaryHash]),
          ),
        ),
    );
    expect(matchingContacts).toEqual([{ id: contact.id, clerkUserId }]);
  });

  it("keeps a pending offer with its original recipient after a client email edit", async () => {
    const now = new Date();
    const invitedEmail = `sk96-frozen-${suffix}@example.invalid`;
    const editedEmail = `sk96-edited-${suffix}@example.invalid`;
    const invitedHash = emailHashFor(invitedEmail);
    const editedHash = emailHashFor(editedEmail);
    const rightfulClerkUserId = `sk96-frozen-owner-${suffix}`;
    const wrongClerkUserId = `sk96-edited-owner-${suffix}`;
    const [contact] = await safely(() =>
      activeDb()
        .insert(clientContacts)
        .values({
          producerId,
          email: invitedEmail,
          emailHash: invitedHash,
          name: "SK-96 Frozen Recipient",
        })
        .returning({ id: clientContacts.id }),
    );
    if (!contact) throw new Error("SK-96 frozen-recipient contact was not created");
    const created = await createPrivateOffer(activeDb(), {
      offerId: randomUUID(),
      producerId,
      recipient: { kind: "existing", clientContactId: contact.id },
      target: { kind: "new" },
      terms: terms({ name: "SK-96 frozen-recipient offer" }),
      now,
    });

    await safely(() =>
      activeDb()
        .update(clientContacts)
        .set({ email: editedEmail, emailHash: editedHash })
        .where(eq(clientContacts.id, contact.id)),
    );
    const [beforeJoin] = await safely(() =>
      activeDb()
        .select({ clerkUserId: clientContacts.clerkUserId })
        .from(clientContacts)
        .where(eq(clientContacts.id, contact.id))
        .limit(1),
    );
    expect(beforeJoin?.clerkUserId).toBeNull();
    await expect(
      connectVerifiedArtistToProducer(activeDb(), {
        producerId,
        primaryEmail: editedEmail,
        verifiedEmailHashes: [editedHash],
        name: "Wrong recipient",
        clerkUserId: wrongClerkUserId,
        now,
      }),
    ).rejects.toMatchObject({ code: "OWNER_CONFLICT" });

    await connectVerifiedArtistToProducer(activeDb(), {
      producerId,
      primaryEmail: invitedEmail,
      verifiedEmailHashes: [invitedHash],
      name: "SK-96 Frozen Recipient",
      clerkUserId: rightfulClerkUserId,
      now,
    });
    await expect(
      getArtistPrivateOffer(activeDb(), {
        clerkUserId: rightfulClerkUserId,
        verifiedEmailHashes: [invitedHash],
        offerId: created.offer.id,
        now,
      }),
    ).resolves.toMatchObject({ id: created.offer.id });
    await expect(
      safely(() =>
        activeDb()
          .update(privateOffers)
          .set({ recipientEmail: editedEmail, recipientEmailHash: editedHash })
          .where(eq(privateOffers.id, created.offer.id)),
      ),
    ).rejects.toThrow("SK-96 isolated database operation failed");
  });

  it("authorizes only the stable invited account and expires at the exact UTC boundary", async () => {
    const createdAt = new Date("2026-07-19T12:00:00.000Z");
    const expiresAt = new Date("2026-07-19T12:00:01.000Z");
    const created = await createPrivateOffer(activeDb(), {
      offerId: randomUUID(),
      producerId,
      recipient: { kind: "existing", clientContactId },
      target: { kind: "new" },
      terms: terms(),
      now: createdAt,
      expiresAt,
    });

    await expect(
      getArtistPrivateOffer(activeDb(), {
        clerkUserId: artistClerkUserId,
        verifiedEmailHashes: artistVerifiedEmailHashes,
        offerId: created.offer.id,
        now: createdAt,
      }),
    ).resolves.toMatchObject({ id: created.offer.id });

    const missing = await offerError(
      getArtistPrivateOffer(activeDb(), {
        clerkUserId: artistClerkUserId,
        verifiedEmailHashes: artistVerifiedEmailHashes,
        offerId: randomUUID(),
        now: createdAt,
      }),
    );
    const foreign = await offerError(
      getArtistPrivateOffer(activeDb(), {
        clerkUserId: otherArtistClerkUserId,
        verifiedEmailHashes: otherArtistVerifiedEmailHashes,
        offerId: created.offer.id,
        now: createdAt,
      }),
    );
    const editedAwayFromVerifiedAccount = await offerError(
      getArtistPrivateOffer(activeDb(), {
        clerkUserId: artistClerkUserId,
        verifiedEmailHashes: otherArtistVerifiedEmailHashes,
        offerId: created.offer.id,
        now: createdAt,
      }),
    );
    for (const hidden of [foreign, editedAwayFromVerifiedAccount]) {
      expect({ code: hidden.code, message: hidden.message }).toEqual({
        code: missing.code,
        message: missing.message,
      });
    }

    const expired = await offerError(
      acceptPrivateOffer(activeDb(), {
        clerkUserId: artistClerkUserId,
        verifiedEmailHashes: artistVerifiedEmailHashes,
        offerId: created.offer.id,
        expectedUpdatedAt: created.offer.updatedAt,
        expectedTargetProjectTitle: null,
        selectedPaymentPlan: { kind: "full" },
        agreementAccepted: true,
        now: expiresAt,
      }),
    );
    expect(expired).toMatchObject({ code: "UNAVAILABLE" });
    const [stored] = await safely(() =>
      activeDb()
        .select({ status: privateOffers.status })
        .from(privateOffers)
        .where(eq(privateOffers.id, created.offer.id))
        .limit(1),
    );
    expect(stored?.status).toBe("expired");
  });

  it("accepts a true zero offer exactly once, activates its new project, and creates no payment state", async () => {
    const now = new Date();
    const created = await createPrivateOffer(activeDb(), {
      offerId: randomUUID(),
      producerId,
      recipient: { kind: "existing", clientContactId },
      target: { kind: "new" },
      terms: terms({ zero: true }),
      now,
    });
    const input = {
      clerkUserId: artistClerkUserId,
      verifiedEmailHashes: artistVerifiedEmailHashes,
      offerId: created.offer.id,
      expectedUpdatedAt: created.offer.updatedAt,
      expectedTargetProjectTitle: null,
      selectedPaymentPlan: null,
      agreementAccepted: true as const,
      now,
    };
    const first = await acceptPrivateOffer(activeDb(), input);
    const replay = await acceptPrivateOffer(activeDb(), input);
    expect(first).toMatchObject({ created: true, lifecycleStatus: "active" });
    expect(replay).toMatchObject({
      created: false,
      purchaseId: first.purchaseId,
      projectId: first.projectId,
      lifecycleStatus: "active",
    });

    const [purchaseRows, acceptanceRows, installmentRows, proofRows, paymentRows, allowanceRows] =
      await Promise.all([
        safely(() =>
          activeDb()
            .select({
              id: purchases.id,
              lifecycleStatus: purchases.lifecycleStatus,
              paymentPlanKind: purchases.paymentPlanKind,
              acceptedAt: purchases.acceptedAt,
              activatedAt: purchases.activatedAt,
              selectedPaymentPlan: purchases.commercialSnapshot,
            })
            .from(purchases)
            .where(eq(purchases.privateOfferId, created.offer.id)),
        ),
        safely(() =>
          activeDb()
            .select({ id: purchaseAcceptances.id })
            .from(purchaseAcceptances)
            .where(eq(purchaseAcceptances.purchaseId, first.purchaseId)),
        ),
        safely(() =>
          activeDb()
            .select({ id: purchaseInstallments.id })
            .from(purchaseInstallments)
            .where(eq(purchaseInstallments.purchaseId, first.purchaseId)),
        ),
        safely(() =>
          activeDb()
            .select({ id: paymentProofs.id })
            .from(paymentProofs)
            .where(eq(paymentProofs.purchaseId, first.purchaseId)),
        ),
        safely(() =>
          activeDb()
            .select({ id: purchasePayments.id })
            .from(purchasePayments)
            .where(eq(purchasePayments.purchaseId, first.purchaseId)),
        ),
        safely(() =>
          activeDb()
            .select({ id: purchaseSessionAllowances.id })
            .from(purchaseSessionAllowances)
            .where(eq(purchaseSessionAllowances.purchaseId, first.purchaseId)),
        ),
      ]);
    expect(purchaseRows).toHaveLength(1);
    expect(purchaseRows[0]).toMatchObject({
      lifecycleStatus: "active",
      paymentPlanKind: null,
    });
    expect(purchaseRows[0]?.acceptedAt).toEqual(purchaseRows[0]?.activatedAt);
    expect(purchaseRows[0]?.selectedPaymentPlan.selectedPaymentPlan).toBeNull();
    expect(acceptanceRows).toHaveLength(1);
    expect(installmentRows).toEqual([]);
    expect(proofRows).toEqual([]);
    expect(paymentRows).toEqual([]);
    expect(allowanceRows).toEqual([]);
    const [project] = await safely(() =>
      activeDb()
        .select({ lifecycleStatus: projects.lifecycleStatus })
        .from(projects)
        .where(eq(projects.id, first.projectId))
        .limit(1),
    );
    expect(project?.lifecycleStatus).toBe("active");
    await completeProject(projectLifecycleRepository(activeDb()), {
      producerId,
      projectId: first.projectId,
      completedAt: new Date(),
    });
  });

  it("serializes accept against reject so the first valid terminal transition wins", async () => {
    const now = new Date();
    const projectId = await createProject({ title: "SK-96 accept-reject race" });
    const created = await createPrivateOffer(activeDb(), {
      offerId: randomUUID(),
      producerId,
      recipient: { kind: "existing", clientContactId },
      target: { kind: "existing", projectId },
      terms: terms({ name: "SK-96 accept reject" }),
      now,
    });

    const [acceptance, rejection] = await Promise.allSettled([
      acceptPrivateOffer(activeDb(), {
        clerkUserId: artistClerkUserId,
        verifiedEmailHashes: artistVerifiedEmailHashes,
        offerId: created.offer.id,
        expectedUpdatedAt: created.offer.updatedAt,
        expectedTargetProjectTitle: "SK-96 accept-reject race",
        selectedPaymentPlan: { kind: "full" },
        agreementAccepted: true,
        now: new Date(),
      }),
      rejectPrivateOffer(activeDb(), {
        clerkUserId: artistClerkUserId,
        verifiedEmailHashes: artistVerifiedEmailHashes,
        offerId: created.offer.id,
        now: new Date(),
      }),
    ]);
    expect([acceptance, rejection].filter((result) => result.status === "fulfilled")).toHaveLength(
      1,
    );
    const [offer] = await safely(() =>
      activeDb()
        .select({ status: privateOffers.status })
        .from(privateOffers)
        .where(eq(privateOffers.id, created.offer.id))
        .limit(1),
    );
    const purchaseRows = await safely(() =>
      activeDb()
        .select({ id: purchases.id })
        .from(purchases)
        .where(eq(purchases.privateOfferId, created.offer.id)),
    );
    expect(purchaseRows).toHaveLength(offer?.status === "accepted" ? 1 : 0);
    expect(["accepted", "declined"]).toContain(offer?.status);
    if (acceptance.status === "fulfilled") {
      await cancelProject(projectLifecycleRepository(activeDb()), {
        producerId,
        projectId: acceptance.value.projectId,
        actorId: "sk96-test-cleanup",
        reason: "Isolated test cleanup",
        canceledAt: new Date(),
      });
    }
  });

  it("serializes producer cancellation against acceptance", async () => {
    const now = new Date();
    const projectId = await createProject({ title: "SK-96 accept-cancel race" });
    const created = await createPrivateOffer(activeDb(), {
      offerId: randomUUID(),
      producerId,
      recipient: { kind: "existing", clientContactId },
      target: { kind: "existing", projectId },
      terms: terms({ name: "SK-96 accept cancel" }),
      now,
    });

    const [acceptance, cancellation] = await Promise.allSettled([
      acceptPrivateOffer(activeDb(), {
        clerkUserId: artistClerkUserId,
        verifiedEmailHashes: artistVerifiedEmailHashes,
        offerId: created.offer.id,
        expectedUpdatedAt: created.offer.updatedAt,
        expectedTargetProjectTitle: "SK-96 accept-cancel race",
        selectedPaymentPlan: { kind: "full" },
        agreementAccepted: true,
        now: new Date(),
      }),
      cancelPrivateOffer(activeDb(), { producerId, offerId: created.offer.id, now: new Date() }),
    ]);
    expect(
      [acceptance, cancellation].filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    const [offer] = await safely(() =>
      activeDb()
        .select({ status: privateOffers.status })
        .from(privateOffers)
        .where(eq(privateOffers.id, created.offer.id))
        .limit(1),
    );
    expect(["accepted", "canceled"]).toContain(offer?.status);
    if (acceptance.status === "fulfilled") {
      await cancelProject(projectLifecycleRepository(activeDb()), {
        producerId,
        projectId: acceptance.value.projectId,
        actorId: "sk96-test-cleanup",
        reason: "Isolated test cleanup",
        canceledAt: new Date(),
      });
    }
  });

  it("corrects only a same-client target before acceptance and locks it afterward", async () => {
    const now = new Date();
    const firstProjectId = await createProject({ title: "SK-96 first target" });
    const correctedProjectId = await createProject({ title: "SK-96 corrected target" });
    const foreignClientProjectId = await createProject({
      title: "SK-96 wrong client target",
      ownerClientContactId: otherClientContactId,
    });
    const created = await createPrivateOffer(activeDb(), {
      offerId: randomUUID(),
      producerId,
      recipient: { kind: "existing", clientContactId },
      target: { kind: "existing", projectId: firstProjectId },
      terms: terms(),
      now,
    });

    const failures = await Promise.all(
      [randomUUID(), foreignClientProjectId].map((projectId) =>
        offerError(
          updatePrivateOffer(activeDb(), {
            producerId,
            offerId: created.offer.id,
            expectedUpdatedAt: created.offer.updatedAt,
            target: { kind: "existing", projectId },
            terms: terms({ name: "Invalid correction" }),
            expiresAt: created.offer.expiresAt,
            now: new Date(),
          }),
        ),
      ),
    );
    expect(failures.map(({ code, message }) => ({ code, message }))).toEqual([
      { code: "NOT_FOUND", message: "This offer is unavailable." },
      { code: "NOT_FOUND", message: "This offer is unavailable." },
    ]);

    const corrected = await updatePrivateOffer(activeDb(), {
      producerId,
      offerId: created.offer.id,
      expectedUpdatedAt: created.offer.updatedAt,
      target: { kind: "existing", projectId: correctedProjectId },
      terms: terms({ name: "Corrected SK-96 terms", session: true }),
      expiresAt: created.offer.expiresAt,
      now: new Date(),
    });
    const accepted = await acceptPrivateOffer(activeDb(), {
      clerkUserId: artistClerkUserId,
      verifiedEmailHashes: artistVerifiedEmailHashes,
      offerId: corrected.id,
      expectedUpdatedAt: corrected.updatedAt,
      expectedTargetProjectTitle: "SK-96 corrected target",
      selectedPaymentPlan: { kind: "full" },
      agreementAccepted: true,
      now: new Date(),
    });
    expect(accepted.projectId).toBe(correctedProjectId);
    await expect(
      updatePrivateOffer(activeDb(), {
        producerId,
        offerId: created.offer.id,
        expectedUpdatedAt: corrected.updatedAt,
        target: { kind: "new" },
        terms: terms({ name: "Too late" }),
        expiresAt: created.offer.expiresAt,
        now: new Date(),
      }),
    ).rejects.toBeTruthy();
    const allowanceRows = await safely(() =>
      activeDb()
        .select({
          purchaseId: purchaseSessionAllowances.purchaseId,
          kind: purchaseSessionAllowances.kind,
          sessionLimit: purchaseSessionAllowances.sessionLimit,
        })
        .from(purchaseSessionAllowances)
        .where(eq(purchaseSessionAllowances.purchaseId, accepted.purchaseId)),
    );
    expect(allowanceRows).toEqual([
      { purchaseId: accepted.purchaseId, kind: "fixed", sessionLimit: 2 },
    ]);
    await cancelProject(projectLifecycleRepository(activeDb()), {
      producerId,
      projectId: accepted.projectId,
      actorId: "sk96-test-cleanup",
      reason: "Isolated test cleanup",
      canceledAt: new Date(),
    });
  });

  it("requires the artist to review a renamed existing project before acceptance", async () => {
    const now = new Date();
    const originalTitle = "SK-96 target before rename";
    const renamedTitle = "SK-96 target after rename";
    const projectId = await createProject({ title: originalTitle });
    const created = await createPrivateOffer(activeDb(), {
      offerId: randomUUID(),
      producerId,
      recipient: { kind: "existing", clientContactId },
      target: { kind: "existing", projectId },
      terms: terms({ name: "SK-96 rename guard" }),
      now,
    });
    const reviewed = await getArtistPrivateOffer(activeDb(), {
      clerkUserId: artistClerkUserId,
      verifiedEmailHashes: artistVerifiedEmailHashes,
      offerId: created.offer.id,
      now,
    });
    expect(reviewed.targetProjectTitle).toBe(originalTitle);

    await safely(() =>
      activeDb().update(projects).set({ title: renamedTitle }).where(eq(projects.id, projectId)),
    );

    const stale = await offerError(
      acceptPrivateOffer(activeDb(), {
        clerkUserId: artistClerkUserId,
        verifiedEmailHashes: artistVerifiedEmailHashes,
        offerId: created.offer.id,
        expectedUpdatedAt: reviewed.updatedAt,
        expectedTargetProjectTitle: originalTitle,
        selectedPaymentPlan: { kind: "full" },
        agreementAccepted: true,
        now: new Date(),
      }),
    );
    expect(stale.code).toBe("STALE");
    await expect(
      safely(() =>
        activeDb()
          .select({ id: purchases.id })
          .from(purchases)
          .where(eq(purchases.privateOfferId, created.offer.id)),
      ),
    ).resolves.toEqual([]);

    await expect(
      acceptPrivateOffer(activeDb(), {
        clerkUserId: artistClerkUserId,
        verifiedEmailHashes: artistVerifiedEmailHashes,
        offerId: created.offer.id,
        expectedUpdatedAt: reviewed.updatedAt,
        expectedTargetProjectTitle: renamedTitle,
        selectedPaymentPlan: { kind: "full" },
        agreementAccepted: true,
        now: new Date(),
      }),
    ).resolves.toMatchObject({ projectId, created: true });
  });
});
