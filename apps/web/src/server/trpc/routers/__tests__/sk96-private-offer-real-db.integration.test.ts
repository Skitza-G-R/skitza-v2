import { randomUUID } from "node:crypto";

import {
  clientContacts,
  createDb,
  eq,
  paymentProofs,
  privateOffers,
  producers,
  projects,
  purchaseAcceptances,
  purchaseInstallments,
  purchasePayments,
  purchases,
  purchaseSessionAllowances,
  sql,
  type Db,
} from "@skitza/db";
import { beforeAll, describe, expect, it } from "vitest";

import { emailHashFor } from "~/server/artist/identity";
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

  beforeAll(async () => {
    const target = approvedTarget;
    if (!target) throw new Error("SK-96 isolated database opt-in was not complete");
    db = createDb(target.targetDatabaseUrl);

    const marker = await safely(() =>
      activeDb().execute<{
        databaseName: string;
        constraintCount: number;
        triggerCount: number;
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
          ) as "triggerCount"
      `),
    );
    const markerRow = marker.rows[0];
    if (
      markerRow?.databaseName !== target.databaseName ||
      markerRow.constraintCount !== 4 ||
      markerRow.triggerCount !== 1
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

  it("authorizes only the stable invited account and expires at the exact UTC boundary", async () => {
    const createdAt = new Date("2026-07-19T12:00:00.000Z");
    const expiresAt = new Date("2026-07-19T12:00:01.000Z");
    const created = await createPrivateOffer(activeDb(), {
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
  });

  it("serializes accept against reject so the first valid terminal transition wins", async () => {
    const now = new Date();
    const projectId = await createProject({ title: "SK-96 accept-reject race" });
    const created = await createPrivateOffer(activeDb(), {
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
  });

  it("serializes producer cancellation against acceptance", async () => {
    const now = new Date();
    const projectId = await createProject({ title: "SK-96 accept-cancel race" });
    const created = await createPrivateOffer(activeDb(), {
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
  });

  it("requires the artist to review a renamed existing project before acceptance", async () => {
    const now = new Date();
    const originalTitle = "SK-96 target before rename";
    const renamedTitle = "SK-96 target after rename";
    const projectId = await createProject({ title: originalTitle });
    const created = await createPrivateOffer(activeDb(), {
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
