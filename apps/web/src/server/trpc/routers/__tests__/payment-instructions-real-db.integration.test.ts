import { randomUUID } from "node:crypto";

import {
  and,
  clientContacts,
  createDb,
  eq,
  producers,
  products,
  projects,
  purchaseAcceptances,
  purchaseInstallments,
  purchasePayments,
  purchases,
  sql,
  type Db,
  type NewPurchaseInstallment,
  type PaymentPlan,
  type PurchaseCommercialSnapshot,
} from "@skitza/db";
import { beforeAll, describe, expect, it } from "vitest";

import {
  getProducerPaymentInstructions,
  loadArtistInstallmentPaymentInstructions,
  PaymentInstructionsNotFoundError,
  saveProducerPaymentInstructions,
} from "~/server/domain/payment-instructions/service";
import { approvedPurchaseRealDbTarget } from "./purchase-real-db-target-gate";

type InstallmentStatus = Exclude<NewPurchaseInstallment["status"], undefined>;

const approvedTarget = approvedPurchaseRealDbTarget(process.env);

/**
 * This suite writes accepted purchase history and therefore runs only against
 * the same explicitly approved disposable target as the purchase-foundation
 * suite. Missing opt-in data skips it before createDb is called.
 */
const describeWithSafeDatabase = approvedTarget ? describe : describe.skip;

async function safely<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch {
    // Driver errors can contain connection metadata and synthetic row ids.
    throw new Error("SK-6 isolated database operation failed");
  }
}

describeWithSafeDatabase("SK-6 payment instructions — isolated disposable Postgres", () => {
  const acceptedAt = new Date("2035-01-02T03:04:05.000Z");
  const now = new Date("2035-02-15T12:00:00.000Z");
  let db: Db | undefined;

  function activeDb(): Db {
    if (!db) throw new Error("SK-6 isolated database was not initialized");
    return db;
  }

  function commercialSnapshot(plan: PaymentPlan, label: string): PurchaseCommercialSnapshot {
    return {
      version: 1,
      productOrOfferName: label,
      tagline: "Frozen SK-6 commercial terms",
      deliverables: ["Stereo master", "Instrumental master"],
      lineItems: [
        {
          label,
          quantity: 1,
          listUnitPriceCents: 10_000,
          unitPriceCents: 10_000,
          totalCents: 10_000,
        },
      ],
      listSubtotalCents: 10_000,
      discountCents: 0,
      subtotalCents: 10_000,
      tax: { mode: "tax_added", ratePct: 17, amountCents: 1_700 },
      totalCents: 11_700,
      currency: "ILS",
      includedSongSpaces: 1,
      session: null,
      revisionRule: { kind: "fixed", count: 2 },
      royaltyTerms: {
        master: { mode: "percentage", bps: 250 },
        composition: { mode: "none" },
        notes: "Frozen royalty note",
      },
      rights: ["Artist may commercially release the accepted master"],
      selectedPaymentPlan: plan,
      offeredPaymentPlans: [plan],
      agreementText: "These exact SK-6 terms were accepted by the artist.",
    };
  }

  async function createAcceptedFixture(input: {
    artistClerkUserId: string;
    paymentDetails: {
      bankTransfer?: string;
      bitPhone?: string;
      note?: string;
    };
    plan?: PaymentPlan;
    statuses?: readonly InstallmentStatus[];
  }) {
    const suffix = randomUUID();
    const plan = input.plan ?? ({ kind: "full" } as const);
    const installmentCount =
      plan.kind === "full" ? 1 : plan.kind === "split_50_50" ? 2 : plan.installments;
    const statuses: readonly InstallmentStatus[] =
      input.statuses ??
      Array.from({ length: installmentCount }, (): InstallmentStatus => "not_paid");
    if (statuses.length !== installmentCount) {
      throw new Error("SK-6 fixture status count must match the selected plan");
    }
    const snapshot = commercialSnapshot(plan, `SK-6 fixture ${suffix}`);

    return safely(() =>
      activeDb().transaction(async (tx) => {
        const [producer] = await tx
          .insert(producers)
          .values({
            clerkUserId: `sk6-producer-${suffix}`,
            email: `producer-${suffix}@example.invalid`,
            slug: `sk6-producer-${suffix}`,
            displayName: `SK-6 Studio ${suffix}`,
            paymentDetails: input.paymentDetails,
          })
          .returning({ id: producers.id });
        if (!producer) throw new Error("SK-6 producer fixture was not created");

        const [contact] = await tx
          .insert(clientContacts)
          .values({
            producerId: producer.id,
            emailHash: `hash-${suffix}`,
            email: `artist-${suffix}@example.invalid`,
            name: "SK-6 Artist",
            clerkUserId: input.artistClerkUserId,
          })
          .returning({ id: clientContacts.id });
        if (!contact) throw new Error("SK-6 client fixture was not created");

        const [project] = await tx
          .insert(projects)
          .values({
            producerId: producer.id,
            clientContactId: contact.id,
            title: `SK-6 project ${suffix}`,
            artistName: "SK-6 Artist",
            artistEmail: `artist-${suffix}@example.invalid`,
          })
          .returning({ id: projects.id });
        if (!project) throw new Error("SK-6 project fixture was not created");

        const [product] = await tx
          .insert(products)
          .values({
            producerId: producer.id,
            name: `SK-6 product ${suffix}`,
            durationMin: 60,
            priceCents: snapshot.subtotalCents,
            currency: snapshot.currency,
            paymentPlans: [plan],
            royaltyTerms: snapshot.royaltyTerms,
            agreementText: snapshot.agreementText,
          })
          .returning({ id: products.id });
        if (!product) throw new Error("SK-6 product fixture was not created");

        const operationKey = `sk6-purchase-${suffix}`;
        const [purchase] = await tx
          .insert(purchases)
          .values({
            producerId: producer.id,
            projectId: project.id,
            clientContactId: contact.id,
            productId: product.id,
            sourceKind: "paid_add_on",
            operationKey,
            operationDigest: `digest-${operationKey}`,
            refNumber: `SK6-${suffix}`,
            paymentPlanKind: plan.kind,
            snapshotDigest: `snapshot-${suffix}`,
            commercialSnapshot: snapshot,
            subtotalCents: snapshot.subtotalCents,
            taxCents: snapshot.tax.amountCents,
            totalCents: snapshot.totalCents,
            currency: snapshot.currency,
            acceptedAt,
          })
          .returning();
        if (!purchase) throw new Error("SK-6 purchase fixture was not created");

        const baseAmount = Math.floor(snapshot.totalCents / installmentCount);
        const remainder = snapshot.totalCents - baseAmount * installmentCount;
        const installments = await tx
          .insert(purchaseInstallments)
          .values(
            statuses.map((status, index) => ({
              purchaseId: purchase.id,
              producerId: producer.id,
              position: index + 1,
              amountCents: baseAmount + (index === 0 ? remainder : 0),
              currency: snapshot.currency,
              dueTrigger:
                index === 0
                  ? ("acceptance" as const)
                  : plan.kind === "monthly"
                    ? ("monthly_anniversary" as const)
                    : ("artist_approval" as const),
              dueAt: new Date(acceptedAt.getTime() + index * 24 * 60 * 60 * 1_000),
              triggeredAt: index === 0 ? acceptedAt : null,
              requiredForActivation: index === 0,
              status,
            })),
          )
          .returning({
            id: purchaseInstallments.id,
            position: purchaseInstallments.position,
            status: purchaseInstallments.status,
          });

        await tx.insert(purchaseAcceptances).values({
          purchaseId: purchase.id,
          producerId: producer.id,
          clientContactId: contact.id,
          acceptedByClerkUserId: input.artistClerkUserId,
          acceptedSnapshot: purchase.commercialSnapshot,
          snapshotDigest: purchase.snapshotDigest,
          acceptedAt: purchase.acceptedAt,
        });

        return {
          producerId: producer.id,
          clientContactId: contact.id,
          purchaseId: purchase.id,
          snapshot,
          installments,
        };
      }),
    );
  }

  async function frozenPurchaseState(purchaseId: string, installmentId: string) {
    return safely(async () => {
      const [[purchase], [acceptance], [installment]] = await Promise.all([
        activeDb()
          .select({
            paymentPlanKind: purchases.paymentPlanKind,
            snapshotDigest: purchases.snapshotDigest,
            commercialSnapshot: purchases.commercialSnapshot,
            subtotalCents: purchases.subtotalCents,
            taxCents: purchases.taxCents,
            totalCents: purchases.totalCents,
            currency: purchases.currency,
            acceptedAt: purchases.acceptedAt,
          })
          .from(purchases)
          .where(eq(purchases.id, purchaseId))
          .limit(1),
        activeDb()
          .select({
            acceptedSnapshot: purchaseAcceptances.acceptedSnapshot,
            snapshotDigest: purchaseAcceptances.snapshotDigest,
            acceptedAt: purchaseAcceptances.acceptedAt,
          })
          .from(purchaseAcceptances)
          .where(eq(purchaseAcceptances.purchaseId, purchaseId))
          .limit(1),
        activeDb()
          .select({
            position: purchaseInstallments.position,
            amountCents: purchaseInstallments.amountCents,
            currency: purchaseInstallments.currency,
            dueTrigger: purchaseInstallments.dueTrigger,
            dueAt: purchaseInstallments.dueAt,
            triggeredAt: purchaseInstallments.triggeredAt,
            requiredForActivation: purchaseInstallments.requiredForActivation,
            status: purchaseInstallments.status,
          })
          .from(purchaseInstallments)
          .where(
            and(
              eq(purchaseInstallments.id, installmentId),
              eq(purchaseInstallments.purchaseId, purchaseId),
            ),
          )
          .limit(1),
      ]);
      if (!purchase || !acceptance || !installment) {
        throw new Error("SK-6 frozen fixture state was not found");
      }
      return { purchase, acceptance, installment };
    });
  }

  beforeAll(async () => {
    const target = approvedTarget;
    if (!target) throw new Error("SK-6 isolated database opt-in was not complete");

    db = createDb(target.targetDatabaseUrl);
    const marker = await safely(() =>
      activeDb().execute<{
        databaseName: string;
        paymentDetailsColumnCount: number;
        installmentStatusCount: number;
        immutabilityTriggerCount: number;
      }>(sql`
        select
          current_database()::text as "databaseName",
          (
            select count(*)::int
            from information_schema.columns
            where table_schema = 'public'
              and table_name = 'producers'
              and column_name = 'payment_details'
          ) as "paymentDetailsColumnCount",
          (
            select count(*)::int
            from pg_enum
            join pg_type on pg_type.oid = pg_enum.enumtypid
            where pg_type.typname = 'purchase_installment_status'
          ) as "installmentStatusCount",
          (
            select count(*)::int
            from pg_trigger
            where tgname in (
              'purchases_protect_commercial_snapshot',
              'purchase_installments_protect_terms'
            )
              and tgenabled = 'O'
              and not tgisinternal
          ) as "immutabilityTriggerCount"
      `),
    );
    const row = marker.rows[0];
    if (
      row?.databaseName !== target.databaseName ||
      row.paymentDetailsColumnCount !== 1 ||
      row.installmentStatusCount !== 7 ||
      row.immutabilityTriggerCount !== 2
    ) {
      throw new Error("SK-6 isolated database identity or schema marker mismatch");
    }
  });

  it("returns each owning producer's current instructions without crossing artist or producer boundaries", async () => {
    const artistClerkUserId = `sk6-artist-${randomUUID()}`;
    const first = await createAcceptedFixture({
      artistClerkUserId,
      paymentDetails: {
        bankTransfer: "First studio bank details",
        bitPhone: "050-111-1111",
        note: "First studio note",
      },
    });
    const second = await createAcceptedFixture({
      artistClerkUserId,
      paymentDetails: {
        bankTransfer: "Second studio bank details",
        bitPhone: "050-222-2222",
        note: "Second studio note",
      },
    });

    await safely(() =>
      saveProducerPaymentInstructions(activeDb(), first.producerId, {
        bankTransfer: "  Current first studio bank details  ",
        bitPhone: " 050-333-3333 ",
        note: "  Include the current reference.  ",
      }),
    );

    const firstResult = await safely(() =>
      loadArtistInstallmentPaymentInstructions(
        activeDb(),
        artistClerkUserId,
        { purchaseId: first.purchaseId },
        now,
      ),
    );
    const secondResult = await safely(() =>
      loadArtistInstallmentPaymentInstructions(
        activeDb(),
        artistClerkUserId,
        { purchaseId: second.purchaseId },
        now,
      ),
    );
    const firstSaved = await safely(() =>
      getProducerPaymentInstructions(activeDb(), first.producerId),
    );
    const secondSaved = await safely(() =>
      getProducerPaymentInstructions(activeDb(), second.producerId),
    );

    expect(firstResult.bankTransfer).toBe("Current first studio bank details");
    expect(firstResult.bitPhone).toBe("050-333-3333");
    expect(firstResult.note).toBe("Include the current reference.");
    expect(firstSaved).toEqual({
      bankTransfer: "Current first studio bank details",
      bitPhone: "050-333-3333",
      note: "Include the current reference.",
    });
    expect(secondResult.bankTransfer).toBe("Second studio bank details");
    expect(secondResult.bitPhone).toBe("050-222-2222");
    expect(secondSaved).toEqual({
      bankTransfer: "Second studio bank details",
      bitPhone: "050-222-2222",
      note: "Second studio note",
    });
    expect(firstResult.purchaseId === first.purchaseId).toBe(true);
    expect(secondResult.purchaseId === second.purchaseId).toBe(true);

    const secondInstallment = second.installments[0];
    if (!secondInstallment) throw new Error("SK-6 cross-producer installment fixture is missing");

    await expect(
      loadArtistInstallmentPaymentInstructions(
        activeDb(),
        `sk6-outsider-${randomUUID()}`,
        { purchaseId: first.purchaseId },
        now,
      ),
    ).rejects.toBeInstanceOf(PaymentInstructionsNotFoundError);

    await expect(
      loadArtistInstallmentPaymentInstructions(
        activeDb(),
        artistClerkUserId,
        {
          purchaseId: first.purchaseId,
          installmentId: secondInstallment.id,
        },
        now,
      ),
    ).rejects.toBeInstanceOf(PaymentInstructionsNotFoundError);

    await safely(() =>
      activeDb()
        .update(clientContacts)
        .set({ archivedAt: now })
        .where(
          and(
            eq(clientContacts.id, second.clientContactId),
            eq(clientContacts.producerId, second.producerId),
          ),
        ),
    );
    await expect(
      loadArtistInstallmentPaymentInstructions(
        activeDb(),
        artistClerkUserId,
        { purchaseId: second.purchaseId },
        now,
      ),
    ).rejects.toBeInstanceOf(PaymentInstructionsNotFoundError);
  });

  it("shows due payable installments and hides proof-review or terminal installments", async () => {
    const statuses = [
      "not_paid",
      "awaiting_review",
      "partially_paid",
      "confirmed",
      "overdue",
      "waived",
      "canceled",
    ] as const satisfies readonly InstallmentStatus[];
    const artistClerkUserId = `sk6-artist-${randomUUID()}`;
    const fixture = await createAcceptedFixture({
      artistClerkUserId,
      paymentDetails: { note: "Pay this installment directly to the producer." },
      plan: { kind: "monthly", installments: statuses.length },
      statuses,
    });

    for (const index of [0, 2, 4]) {
      const installment = fixture.installments[index];
      if (!installment) throw new Error("SK-6 visible installment fixture is missing");
      const result = await safely(() =>
        loadArtistInstallmentPaymentInstructions(
          activeDb(),
          artistClerkUserId,
          { purchaseId: fixture.purchaseId, installmentId: installment.id },
          now,
        ),
      );
      expect(result.installmentPosition).toBe(index + 1);
      expect(result.installmentStatus).toBe(statuses[index]);
      expect(result.amountDueNowCents).toBeGreaterThan(0);
      expect(result.hasDetails).toBe(true);
      expect(result.note).toBe("Pay this installment directly to the producer.");
    }

    for (const index of [1, 3, 5, 6]) {
      const installment = fixture.installments[index];
      if (!installment) throw new Error("SK-6 hidden installment fixture is missing");
      await expect(
        loadArtistInstallmentPaymentInstructions(
          activeDb(),
          artistClerkUserId,
          { purchaseId: fixture.purchaseId, installmentId: installment.id },
          now,
        ),
      ).rejects.toBeInstanceOf(PaymentInstructionsNotFoundError);
    }
  });

  it("keeps canceled debt and another installment's overpayment out of the remaining balance", async () => {
    const artistClerkUserId = `sk6-artist-${randomUUID()}`;
    const fixture = await createAcceptedFixture({
      artistClerkUserId,
      paymentDetails: { bankTransfer: "Exact-installment destination" },
      plan: { kind: "monthly", installments: 3 },
      statuses: ["confirmed", "not_paid", "canceled"],
    });
    const first = fixture.installments[0];
    const second = fixture.installments[1];
    if (!first || !second) throw new Error("SK-6 overpayment fixture is missing");
    const installmentCents = fixture.snapshot.totalCents / 3;
    const overpaymentCents = 500;
    await safely(() =>
      activeDb()
        .insert(purchasePayments)
        .values({
          purchaseId: fixture.purchaseId,
          installmentId: first.id,
          producerId: fixture.producerId,
          operationKey: `sk6-overpayment-${randomUUID()}`,
          operationDigest: `sk6-overpayment-digest-${randomUUID()}`,
          source: "manual",
          amountCents: installmentCents + overpaymentCents,
          currency: fixture.snapshot.currency,
          paidAt: now,
          addedByClerkUserId: `sk6-producer-actor-${randomUUID()}`,
        }),
    );

    const overpaidResult = await safely(() =>
      loadArtistInstallmentPaymentInstructions(
        activeDb(),
        artistClerkUserId,
        { purchaseId: fixture.purchaseId, installmentId: second.id },
        now,
      ),
    );
    expect(overpaidResult.paidCents).toBe(installmentCents + overpaymentCents);
    expect(overpaidResult.amountDueNowCents).toBe(installmentCents);
    expect(overpaidResult.remainingCents).toBe(installmentCents);
  });

  it("updates current instructions without changing accepted commercial terms or the schedule", async () => {
    const artistClerkUserId = `sk6-artist-${randomUUID()}`;
    const fixture = await createAcceptedFixture({
      artistClerkUserId,
      paymentDetails: { bankTransfer: "Original transfer destination" },
    });
    const installment = fixture.installments[0];
    if (!installment) throw new Error("SK-6 immutable installment fixture is missing");

    const before = await frozenPurchaseState(fixture.purchaseId, installment.id);
    await safely(() =>
      saveProducerPaymentInstructions(activeDb(), fixture.producerId, {
        bankTransfer: "Replacement transfer destination",
        bitPhone: "050-444-4444",
        note: "Use the purchase reference from Skitza.",
      }),
    );
    const after = await frozenPurchaseState(fixture.purchaseId, installment.id);
    const instructions = await safely(() =>
      loadArtistInstallmentPaymentInstructions(
        activeDb(),
        artistClerkUserId,
        { purchaseId: fixture.purchaseId, installmentId: installment.id },
        now,
      ),
    );

    expect(after).toEqual(before);
    expect(instructions.bankTransfer).toBe("Replacement transfer destination");
    expect(instructions.bitPhone).toBe("050-444-4444");
    expect(instructions.note).toBe("Use the purchase reference from Skitza.");
    expect(instructions.productName).toBe(fixture.snapshot.productOrOfferName);
    expect(instructions.currency).toBe(fixture.snapshot.currency);
    expect(instructions.totalCents).toBe(fixture.snapshot.totalCents);
    expect(instructions.amountDueNowCents).toBe(fixture.snapshot.totalCents);
    expect(instructions.planKind).toBe("full");
  });
});
