import { randomUUID } from "node:crypto";

import {
  bookings,
  clientContacts,
  createDb,
  eq,
  notifications,
  paymentProofs,
  producers,
  products,
  projectTracks,
  projects,
  purchaseAcceptances,
  purchaseInstallments,
  purchaseRequests,
  purchaseSessionAllowances,
  purchases,
  sql,
  trackComments,
  trackVersions,
  versionApprovalEvents,
  type Db,
  type NewPaymentProof,
  type NewPurchase,
  type PurchaseCommercialSnapshot,
} from "@skitza/db";
import { beforeAll, describe, expect, it } from "vitest";

import { createAudioIdentityFingerprint } from "../audio";
import { approvedPurchaseRealDbTarget } from "./purchase-real-db-target-gate";

type PaymentPlanKind = Exclude<NewPurchase["paymentPlanKind"], undefined>;
type PaidPaymentPlanKind = Exclude<PaymentPlanKind, null>;

const approvedTarget = approvedPurchaseRealDbTarget(process.env);

/**
 * This suite writes immutable purchase history, so it may run only against an
 * explicitly approved disposable database. Missing or incomplete opt-in data
 * skips the suite before createDb is called. The forbidden list must include
 * separate sanitized fingerprints for both audited Neon projects.
 */
const describeWithSafeDatabase = approvedTarget ? describe : describe.skip;

function postgresErrorCode(error: unknown): string | null {
  let current = error;

  for (let depth = 0; depth < 3; depth += 1) {
    if (!current || typeof current !== "object") return null;
    const record = current as Record<string, unknown>;
    const code = record.code;
    if (typeof code === "string") return code;
    current = record.cause;
  }

  return null;
}

async function rejectedPostgresCode(operation: () => Promise<unknown>): Promise<string | null> {
  try {
    await operation();
    return null;
  } catch (error) {
    return postgresErrorCode(error);
  }
}

async function safely<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch {
    // Do not allow driver failures to expose connection details, row IDs, or
    // synthetic storage keys in test output.
    throw new Error("SK-90 isolated database operation failed");
  }
}

describeWithSafeDatabase("SK-90 purchase constraints — isolated disposable Postgres", () => {
  const fixtureSuffix = randomUUID();
  const acceptedAt = new Date("2035-01-02T03:04:05.000Z");
  let db: Db | undefined;
  let producerId = "";
  let clientContactId = "";
  let projectId = "";
  let productId = "";
  const installmentIdsByPurchase = new Map<string, Map<number, string>>();

  function activeDb(): Db {
    if (!db) throw new Error("SK-90 isolated database was not initialized");
    return db;
  }

  function commercialSnapshot(
    totalCents: number,
    selectedPaymentPlan: PurchaseCommercialSnapshot["selectedPaymentPlan"],
  ): PurchaseCommercialSnapshot {
    return {
      version: 1,
      productOrOfferName: "SK-90 constraint fixture",
      deliverables: [],
      lineItems: [
        {
          label: "SK-90 fixture",
          quantity: 1,
          listUnitPriceCents: totalCents,
          unitPriceCents: totalCents,
          totalCents,
        },
      ],
      listSubtotalCents: totalCents,
      discountCents: 0,
      subtotalCents: totalCents,
      tax: { mode: "tax_free", ratePct: 0, amountCents: 0 },
      totalCents,
      currency: "USD",
      includedSongSpaces: 0,
      session: null,
      revisionRule: null,
      royaltyTerms: null,
      rights: [],
      selectedPaymentPlan,
      offeredPaymentPlans: selectedPaymentPlan ? [selectedPaymentPlan] : [],
      agreementText: "SK-90 isolated integration fixture",
    };
  }

  function purchaseValues(input: {
    totalCents: number;
    paymentPlanKind: PaymentPlanKind;
    operationKey?: string;
  }): NewPurchase {
    const operationKey = input.operationKey ?? `purchase-${randomUUID()}`;
    const selectedPaymentPlan: PurchaseCommercialSnapshot["selectedPaymentPlan"] =
      input.paymentPlanKind === "monthly"
        ? { kind: "monthly", installments: 2 }
        : input.paymentPlanKind
          ? { kind: input.paymentPlanKind }
          : null;
    const snapshot = commercialSnapshot(input.totalCents, selectedPaymentPlan);

    return {
      producerId,
      projectId,
      clientContactId,
      productId,
      sourceKind: input.totalCents === 0 ? "no_charge_add_on" : "paid_add_on",
      operationKey,
      operationDigest: `digest-${operationKey}`,
      refNumber: `SK90-${randomUUID()}`,
      paymentPlanKind: input.paymentPlanKind,
      snapshotDigest: `snapshot-${randomUUID()}`,
      commercialSnapshot: snapshot,
      subtotalCents: input.totalCents,
      taxCents: 0,
      totalCents: input.totalCents,
      currency: "USD",
      acceptedAt,
      ...(input.totalCents === 0
        ? { lifecycleStatus: "active" as const, activatedAt: acceptedAt }
        : {}),
    };
  }

  function proofValues(input: {
    purchaseId: string;
    installmentId: string;
    replacesProofId?: string;
    id?: string;
    status?: NewPaymentProof["status"];
  }): NewPaymentProof {
    const status = input.status ?? "rejected";

    return {
      ...(input.id ? { id: input.id } : {}),
      purchaseId: input.purchaseId,
      installmentId: input.installmentId,
      producerId,
      projectId,
      clientContactId,
      ...(input.replacesProofId ? { replacesProofId: input.replacesProofId } : {}),
      amountCents: 100,
      currency: "USD",
      storageKey: `sk90-isolated/${fixtureSuffix}/${randomUUID()}`,
      objectEtag: `etag-${randomUUID()}`,
      contentType: "image/png",
      sizeBytes: 1,
      status,
      ...(status === "rejected"
        ? { rejectedAt: acceptedAt, rejectionNote: "Superseded test evidence" }
        : {}),
    };
  }

  async function createPaidPurchase(): Promise<string> {
    const result = await safely(() =>
      insertPaidPurchaseWithSchedule({
        totalCents: 200,
        paymentPlanKind: "split_50_50",
      }),
    );
    installmentIdsByPurchase.set(
      result.purchase.id,
      new Map(result.installments.map((installment) => [installment.position, installment.id])),
    );
    return result.purchase.id;
  }

  function createInstallment(purchaseId: string, position: number): Promise<string> {
    const installmentId = installmentIdsByPurchase.get(purchaseId)?.get(position);
    if (!installmentId) throw new Error("SK-90 installment fixture was not created");
    return Promise.resolve(installmentId);
  }

  async function insertPaidPurchaseWithSchedule(input: {
    totalCents: number;
    paymentPlanKind: PaidPaymentPlanKind;
    operationKey?: string;
    overrides?: Partial<NewPurchase>;
    amounts?: number[];
  }) {
    return activeDb().transaction(async (tx) => {
      const [purchase] = await tx
        .insert(purchases)
        .values({
          ...purchaseValues({
            totalCents: input.totalCents,
            paymentPlanKind: input.paymentPlanKind,
            ...(input.operationKey ? { operationKey: input.operationKey } : {}),
          }),
          ...input.overrides,
        })
        .returning();
      if (!purchase) throw new Error("SK-90 purchase fixture was not created");

      const installmentCount = input.paymentPlanKind === "full" ? 1 : 2;
      const baseAmount = Math.floor(input.totalCents / installmentCount);
      const remainder = input.totalCents - baseAmount * installmentCount;
      const amounts =
        input.amounts ??
        Array.from({ length: installmentCount }, (_, index) =>
          index === 0 ? baseAmount + remainder : baseAmount,
        );
      const insertedInstallments = await tx
        .insert(purchaseInstallments)
        .values(
          amounts.map((amountCents, index) => ({
            purchaseId: purchase.id,
            producerId,
            position: index + 1,
            amountCents,
            currency: "USD",
            dueTrigger:
              index === 0
                ? ("acceptance" as const)
                : input.paymentPlanKind === "monthly"
                  ? ("monthly_anniversary" as const)
                  : ("artist_approval" as const),
            requiredForActivation: index === 0,
          })),
        )
        .returning({ id: purchaseInstallments.id, position: purchaseInstallments.position });

      return { purchase, installments: insertedInstallments };
    });
  }

  async function createProduct(): Promise<string> {
    const [product] = await safely(() =>
      activeDb()
        .insert(products)
        .values({
          producerId,
          name: "SK-90 request fixture",
          durationMin: 60,
          priceCents: 100,
        })
        .returning({ id: products.id }),
    );
    if (!product) throw new Error("SK-90 product fixture was not created");
    return product.id;
  }

  async function createPurchaseRequest(productId: string, boundProjectId: string): Promise<string> {
    const operationKey = `request-${randomUUID()}`;
    const [request] = await safely(() =>
      activeDb()
        .insert(purchaseRequests)
        .values({
          producerId,
          clientContactId,
          productId,
          projectId: boundProjectId,
          operationKey,
          operationDigest: `digest-${operationKey}`,
          refNumber: `SK90-REQ-${randomUUID()}`,
          artistName: "SK-90 Artist Fixture",
          artistEmail: `artist-${fixtureSuffix}@example.invalid`,
        })
        .returning({ id: purchaseRequests.id }),
    );
    if (!request) throw new Error("SK-90 purchase request fixture was not created");
    return request.id;
  }

  beforeAll(async () => {
    const target = approvedTarget;
    if (!target) {
      throw new Error("SK-90 isolated database opt-in was not complete");
    }

    db = createDb(target.targetDatabaseUrl);

    const marker = await safely(() =>
      activeDb().execute<{
        databaseName: string;
        markerCount: number;
        triggerMarkerCount: number;
      }>(sql`
        select
          current_database()::text as "databaseName",
          (
            select count(*)::int
            from pg_constraint
            where connamespace = 'public'::regnamespace
              and conname in (
                'purchases_payment_plan_shape',
                'purchases_zero_total_activation_shape',
                'purchases_lifecycle_timestamp_shape',
                'purchases_snapshot_scalar_consistency',
                'purchases_agreement_text_shape',
                'purchases_source_link_shape',
                'purchases_source_amount_shape',
                'purchases_operation_key_unique',
                'purchase_requests_status_timestamp_shape',
                'purchase_installments_positive_amount',
                'payment_proofs_replacement_identity_fk',
                'payment_proofs_does_not_replace_self',
                'payment_proofs_status_shape',
                'purchase_session_allowances_close_shape',
                'track_versions_audio_identity_shape',
                'version_approval_events_audio_identity_fk',
                'notifications_project_producer_fk'
              )
          ) as "markerCount",
          (
            select count(*)::int
            from pg_trigger
            where tgname in (
                'purchase_acceptances_validate_purchase',
                'purchase_acceptances_validate_schedule',
                'purchase_installments_require_paid_purchase',
                'purchase_installments_reject_accepted_append',
                'purchase_installments_validate_schedule',
                'payment_proofs_validate_replacement',
                'private_offers_protect_purchase_source',
                'purchase_requests_protect_identity',
                'purchases_validate_installment_schedule',
                'purchases_validate_source_links',
                'track_versions_protect_identity'
              )
              and tgenabled = 'O'
              and not tgisinternal
          ) as "triggerMarkerCount"
      `),
    );
    const markerRow = marker.rows[0];
    if (
      markerRow?.databaseName !== target.databaseName ||
      markerRow.markerCount !== 17 ||
      markerRow.triggerMarkerCount !== 11
    ) {
      throw new Error("SK-90 isolated database identity or schema marker mismatch");
    }

    const [producer] = await safely(() =>
      activeDb()
        .insert(producers)
        .values({
          clerkUserId: `sk90-test-${fixtureSuffix}`,
          email: `sk90-${fixtureSuffix}@example.invalid`,
          slug: `sk90-test-${fixtureSuffix}`,
        })
        .returning({ id: producers.id }),
    );
    if (!producer) throw new Error("SK-90 producer fixture was not created");
    producerId = producer.id;

    const [contact] = await safely(() =>
      activeDb()
        .insert(clientContacts)
        .values({
          producerId,
          emailHash: `hash-${fixtureSuffix}`,
          email: `artist-${fixtureSuffix}@example.invalid`,
          name: "SK-90 Artist Fixture",
        })
        .returning({ id: clientContacts.id }),
    );
    if (!contact) throw new Error("SK-90 client fixture was not created");
    clientContactId = contact.id;

    const [project] = await safely(() =>
      activeDb()
        .insert(projects)
        .values({
          producerId,
          clientContactId,
          title: "SK-90 constraint project",
          artistName: "SK-90 Artist Fixture",
          artistEmail: `artist-${fixtureSuffix}@example.invalid`,
        })
        .returning({ id: projects.id }),
    );
    if (!project) throw new Error("SK-90 project fixture was not created");
    projectId = project.id;
    productId = await createProduct();
  });

  it("activates a zero-total purchase immediately without installments or proofs", async () => {
    const [purchase] = await safely(() =>
      activeDb()
        .insert(purchases)
        .values(purchaseValues({ totalCents: 0, paymentPlanKind: null }))
        .returning({
          id: purchases.id,
          totalCents: purchases.totalCents,
          paymentPlanKind: purchases.paymentPlanKind,
          lifecycleStatus: purchases.lifecycleStatus,
          activatedAt: purchases.activatedAt,
        }),
    );

    if (!purchase) throw new Error("SK-90 zero-total purchase fixture was not created");
    expect(typeof purchase.id).toBe("string");
    expect(purchase).toMatchObject({
      totalCents: 0,
      paymentPlanKind: null,
      lifecycleStatus: "active",
      activatedAt: acceptedAt,
    });
    expect(
      await rejectedPostgresCode(() =>
        activeDb()
          .insert(purchases)
          .values(purchaseValues({ totalCents: 0, paymentPlanKind: "full" })),
      ),
    ).toBe("23514");

    expect(
      await rejectedPostgresCode(() =>
        activeDb()
          .insert(purchases)
          .values({
            ...purchaseValues({ totalCents: 0, paymentPlanKind: null }),
            lifecycleStatus: "active",
            activatedAt: null,
          }),
      ),
    ).toBe("23514");

    expect(
      await rejectedPostgresCode(() =>
        activeDb()
          .insert(purchases)
          .values({
            ...purchaseValues({ totalCents: 0, paymentPlanKind: null }),
            lifecycleStatus: "waiting_for_payment",
            activatedAt: null,
          }),
      ),
    ).toBe("23514");

    expect(
      await rejectedPostgresCode(() =>
        activeDb().insert(purchaseInstallments).values({
          purchaseId: purchase.id,
          producerId,
          position: 1,
          amountCents: 1,
          currency: "USD",
          dueTrigger: "acceptance",
          requiredForActivation: true,
        }),
      ),
    ).toBe("23514");

    expect(
      await rejectedPostgresCode(() =>
        activeDb()
          .insert(paymentProofs)
          .values(proofValues({ purchaseId: purchase.id, installmentId: randomUUID() })),
      ),
    ).toBe("23503");
  });

  it("accepts a paid purchase only with a non-null payment plan", async () => {
    expect(
      await rejectedPostgresCode(() =>
        activeDb()
          .insert(purchases)
          .values(purchaseValues({ totalCents: 100, paymentPlanKind: null })),
      ),
    ).toBe("23514");
    expect(
      await rejectedPostgresCode(() =>
        activeDb()
          .insert(purchases)
          .values(purchaseValues({ totalCents: 100, paymentPlanKind: "full" })),
      ),
    ).toBe("23514");

    const { purchase } = await safely(() =>
      insertPaidPurchaseWithSchedule({ totalCents: 100, paymentPlanKind: "full" }),
    );
    expect(typeof purchase.id).toBe("string");
    expect(purchase).toMatchObject({
      totalCents: 100,
      paymentPlanKind: "full",
    });
    expect(
      await rejectedPostgresCode(() =>
        activeDb().insert(purchaseInstallments).values({
          purchaseId: purchase.id,
          producerId,
          position: 1,
          amountCents: 0,
          currency: "USD",
          dueTrigger: "acceptance",
          requiredForActivation: true,
        }),
      ),
    ).toBe("23514");

    expect(
      await rejectedPostgresCode(() =>
        insertPaidPurchaseWithSchedule({
          totalCents: 101,
          paymentPlanKind: "split_50_50",
          amounts: [50, 51],
        }),
      ),
    ).toBe("23514");
  });

  it("binds acceptance history to the exact purchase and keeps purchase lifecycle monotonic", async () => {
    const { purchase } = await safely(() =>
      insertPaidPurchaseWithSchedule({ totalCents: 100, paymentPlanKind: "full" }),
    );

    const exactAcceptance = {
      purchaseId: purchase.id,
      producerId,
      clientContactId,
      acceptedByClerkUserId: `sk90-artist-${fixtureSuffix}`,
      acceptedSnapshot: purchase.commercialSnapshot,
      snapshotDigest: purchase.snapshotDigest,
      acceptedAt: purchase.acceptedAt,
    };

    expect(
      await rejectedPostgresCode(() =>
        activeDb()
          .insert(purchaseAcceptances)
          .values({
            ...exactAcceptance,
            acceptedSnapshot: {
              ...purchase.commercialSnapshot,
              agreementText: "Tampered acceptance fixture",
            },
          }),
      ),
    ).toBe("23514");
    expect(
      await rejectedPostgresCode(() =>
        activeDb()
          .insert(purchaseAcceptances)
          .values({
            ...exactAcceptance,
            acceptedAt: new Date(purchase.acceptedAt.getTime() + 1),
          }),
      ),
    ).toBe("23514");
    await safely(() => activeDb().insert(purchaseAcceptances).values(exactAcceptance));

    await safely(() =>
      activeDb()
        .update(purchases)
        .set({ lifecycleStatus: "active", activatedAt: purchase.acceptedAt })
        .where(eq(purchases.id, purchase.id)),
    );
    expect(
      await rejectedPostgresCode(() =>
        activeDb()
          .update(purchases)
          .set({ lifecycleStatus: "waiting_for_payment", activatedAt: null })
          .where(eq(purchases.id, purchase.id)),
      ),
    ).toBe("P0001");

    expect(
      await rejectedPostgresCode(() =>
        activeDb().insert(purchaseInstallments).values({
          purchaseId: purchase.id,
          producerId,
          position: 2,
          amountCents: 1,
          currency: "USD",
          dueTrigger: "artist_approval",
          requiredForActivation: false,
        }),
      ),
    ).toBe("23514");
  });

  it("freezes installment dates and terminal status plus session closure", async () => {
    const purchaseId = await createPaidPurchase();
    const installmentId = await createInstallment(purchaseId, 1);
    const firstDueAt = new Date("2035-02-01T00:00:00.000Z");

    await safely(() =>
      activeDb()
        .update(purchaseInstallments)
        .set({ dueAt: firstDueAt, triggeredAt: acceptedAt })
        .where(eq(purchaseInstallments.id, installmentId)),
    );
    expect(
      await rejectedPostgresCode(() =>
        activeDb()
          .update(purchaseInstallments)
          .set({ dueAt: new Date("2035-02-02T00:00:00.000Z") })
          .where(eq(purchaseInstallments.id, installmentId)),
      ),
    ).toBe("P0001");
    await safely(() =>
      activeDb()
        .update(purchaseInstallments)
        .set({ status: "confirmed" })
        .where(eq(purchaseInstallments.id, installmentId)),
    );
    expect(
      await rejectedPostgresCode(() =>
        activeDb()
          .update(purchaseInstallments)
          .set({ status: "not_paid" })
          .where(eq(purchaseInstallments.id, installmentId)),
      ),
    ).toBe("P0001");

    expect(
      await rejectedPostgresCode(() =>
        activeDb().insert(purchaseSessionAllowances).values({
          purchaseId,
          producerId,
          kind: "fixed",
          sessionLimit: null,
          durationMin: 60,
          locationType: "studio",
          bufferMinutes: 15,
          minLeadHours: 24,
        }),
      ),
    ).toBe("23514");

    const [allowance] = await safely(() =>
      activeDb()
        .insert(purchaseSessionAllowances)
        .values({
          purchaseId,
          producerId,
          kind: "fixed",
          sessionLimit: 1,
          durationMin: 60,
          locationType: "studio",
          bufferMinutes: 15,
          minLeadHours: 24,
        })
        .returning({ id: purchaseSessionAllowances.id }),
    );
    if (!allowance) throw new Error("SK-90 session allowance fixture was not created");
    await safely(() =>
      activeDb()
        .update(purchaseSessionAllowances)
        .set({ closedAt: acceptedAt, closeReason: "project_completed" })
        .where(eq(purchaseSessionAllowances.id, allowance.id)),
    );
    expect(
      await rejectedPostgresCode(() =>
        activeDb()
          .update(purchaseSessionAllowances)
          .set({ closedAt: null, closeReason: null })
          .where(eq(purchaseSessionAllowances.id, allowance.id)),
      ),
    ).toBe("P0001");
  });

  it("allows only a same-owner project correction before request conversion", async () => {
    const productId = await createProduct();
    const requestId = await createPurchaseRequest(productId, projectId);
    const [sameOwnerProject] = await safely(() =>
      activeDb()
        .insert(projects)
        .values({
          producerId,
          clientContactId,
          title: "SK-90 corrected request project",
          artistName: "SK-90 Artist Fixture",
          artistEmail: `artist-${fixtureSuffix}@example.invalid`,
        })
        .returning({ id: projects.id }),
    );
    if (!sameOwnerProject) throw new Error("SK-90 correction project fixture was not created");

    await safely(() =>
      activeDb()
        .update(purchaseRequests)
        .set({ projectId: sameOwnerProject.id })
        .where(eq(purchaseRequests.id, requestId)),
    );

    const [otherContact] = await safely(() =>
      activeDb()
        .insert(clientContacts)
        .values({
          producerId,
          emailHash: `other-hash-${fixtureSuffix}`,
          email: `other-${fixtureSuffix}@example.invalid`,
          name: "Other SK-90 Artist",
        })
        .returning({ id: clientContacts.id }),
    );
    if (!otherContact) throw new Error("SK-90 other-client fixture was not created");
    const [foreignClientProject] = await safely(() =>
      activeDb()
        .insert(projects)
        .values({
          producerId,
          clientContactId: otherContact.id,
          title: "SK-90 foreign-client project",
          artistName: "Other SK-90 Artist",
          artistEmail: `other-${fixtureSuffix}@example.invalid`,
        })
        .returning({ id: projects.id }),
    );
    if (!foreignClientProject) throw new Error("SK-90 foreign-client project was not created");

    expect(
      await rejectedPostgresCode(() =>
        activeDb()
          .update(purchaseRequests)
          .set({ projectId: foreignClientProject.id })
          .where(eq(purchaseRequests.id, requestId)),
      ),
    ).toBe("23514");

    await safely(() =>
      insertPaidPurchaseWithSchedule({
        totalCents: 100,
        paymentPlanKind: "full",
        overrides: {
          productId,
          projectId: sameOwnerProject.id,
          purchaseRequestId: requestId,
        },
      }),
    );
    const convertedAt = new Date(acceptedAt.getTime() + 1_000);
    await safely(() =>
      activeDb()
        .update(purchaseRequests)
        .set({ status: "converted", statusChangedAt: convertedAt, convertedAt })
        .where(eq(purchaseRequests.id, requestId)),
    );
    expect(
      await rejectedPostgresCode(() =>
        activeDb()
          .update(purchaseRequests)
          .set({ status: "pending", statusChangedAt: acceptedAt, convertedAt: null })
          .where(eq(purchaseRequests.id, requestId)),
      ),
    ).toBe("23514");
    expect(
      await rejectedPostgresCode(() =>
        activeDb()
          .update(purchaseRequests)
          .set({ convertedAt: null })
          .where(eq(purchaseRequests.id, requestId)),
      ),
    ).toBe("23514");
    expect(
      await rejectedPostgresCode(() =>
        activeDb()
          .update(purchaseRequests)
          .set({ projectId })
          .where(eq(purchaseRequests.id, requestId)),
      ),
    ).toBe("23514");
  });

  it("binds approval to exact audio identity and freezes that identity afterward", async () => {
    const purchaseId = await createPaidPurchase();
    const [track] = await safely(() =>
      activeDb()
        .insert(projectTracks)
        .values({ projectId, purchaseId, title: "SK-90 approval track" })
        .returning({ id: projectTracks.id }),
    );
    if (!track) throw new Error("SK-90 approval track fixture was not created");

    const audioR2Key = `sk90-isolated/${fixtureSuffix}/${randomUUID()}`;
    const audioUrl = `/api/audio/sk90/${randomUUID()}`;
    const sizeBytes = 123;
    const audioObjectEtag = `etag-${randomUUID()}`;
    const audioIdentityFingerprint = createAudioIdentityFingerprint({
      key: audioR2Key,
      objectEtag: audioObjectEtag,
      sizeBytes,
    });
    const [version] = await safely(() =>
      activeDb()
        .insert(trackVersions)
        .values({
          trackId: track.id,
          purchaseId,
          producerId,
          label: "Approval V1",
          audioUrl,
          audioR2Key,
          sizeBytes,
          audioObjectEtag,
          audioIdentityFingerprint,
        })
        .returning({ id: trackVersions.id }),
    );
    if (!version) throw new Error("SK-90 approval version fixture was not created");

    const changedAudioR2Key = `sk90-isolated/${fixtureSuffix}/${randomUUID()}`;
    const changedAudioObjectEtag = `etag-${randomUUID()}`;
    const changedSizeBytes = sizeBytes + 1;
    const changedAudioIdentityFingerprint = createAudioIdentityFingerprint({
      key: changedAudioR2Key,
      objectEtag: changedAudioObjectEtag,
      sizeBytes: changedSizeBytes,
    });
    expect(
      await rejectedPostgresCode(() =>
        activeDb()
          .update(trackVersions)
          .set({
            audioUrl: `/api/audio/sk90/${randomUUID()}`,
            audioR2Key: changedAudioR2Key,
            sizeBytes: changedSizeBytes,
            audioObjectEtag: changedAudioObjectEtag,
            audioIdentityFingerprint: changedAudioIdentityFingerprint,
          })
          .where(eq(trackVersions.id, version.id)),
      ),
    ).toBe("P0001");

    const approval = {
      versionId: version.id,
      purchaseId,
      producerId,
      clientContactId,
      action: "approved" as const,
      actedByClerkUserId: `sk90-artist-${fixtureSuffix}`,
    };
    expect(
      await rejectedPostgresCode(() =>
        activeDb()
          .insert(versionApprovalEvents)
          .values({ ...approval, audioIdentityFingerprint: `sha256:${"b".repeat(64)}` }),
      ),
    ).toBe("23503");
    await safely(() =>
      activeDb()
        .insert(versionApprovalEvents)
        .values({ ...approval, audioIdentityFingerprint }),
    );
    expect(
      await rejectedPostgresCode(() =>
        activeDb()
          .update(trackVersions)
          .set({ audioObjectEtag: `changed-${randomUUID()}` })
          .where(eq(trackVersions.id, version.id)),
      ),
    ).toBe("P0001");
  });

  it("allows one live placeholder completion and keeps placeholder/completed tombstones monotonic", async () => {
    const purchaseId = await createPaidPurchase();
    const [track] = await safely(() =>
      activeDb()
        .insert(projectTracks)
        .values({ projectId, purchaseId, title: "SK-90 audio state track" })
        .returning({ id: projectTracks.id }),
    );
    if (!track) throw new Error("SK-90 audio state track fixture was not created");

    const [failedPlaceholder] = await safely(() =>
      activeDb()
        .insert(trackVersions)
        .values({ trackId: track.id, purchaseId, producerId, label: "Failed placeholder" })
        .returning({ id: trackVersions.id }),
    );
    if (!failedPlaceholder) throw new Error("SK-90 failed placeholder was not created");
    const failedAt = new Date("2035-01-03T03:04:05.000Z");
    await safely(() =>
      activeDb()
        .update(trackVersions)
        .set({ audioDeletedAt: failedAt })
        .where(eq(trackVersions.id, failedPlaceholder.id)),
    );

    const rejectedAttachmentKey = `sk90-isolated/${fixtureSuffix}/${randomUUID()}`;
    const rejectedAttachmentEtag = `etag-${randomUUID()}`;
    const rejectedAttachmentSize = 321;
    const rejectedAttachmentFingerprint = createAudioIdentityFingerprint({
      key: rejectedAttachmentKey,
      objectEtag: rejectedAttachmentEtag,
      sizeBytes: rejectedAttachmentSize,
    });
    expect(
      await rejectedPostgresCode(() =>
        activeDb()
          .update(trackVersions)
          .set({
            audioUrl: `/api/audio/sk90/${randomUUID()}`,
            audioR2Key: rejectedAttachmentKey,
            sizeBytes: rejectedAttachmentSize,
            audioObjectEtag: rejectedAttachmentEtag,
            audioIdentityFingerprint: rejectedAttachmentFingerprint,
          })
          .where(eq(trackVersions.id, failedPlaceholder.id)),
      ),
    ).toBe("P0001");
    expect(
      await rejectedPostgresCode(() =>
        activeDb()
          .update(trackVersions)
          .set({ audioDeletedAt: null })
          .where(eq(trackVersions.id, failedPlaceholder.id)),
      ),
    ).toBe("P0001");
    expect(
      await rejectedPostgresCode(() =>
        activeDb()
          .update(trackVersions)
          .set({ audioDeletedAt: new Date(failedAt.getTime() + 1_000) })
          .where(eq(trackVersions.id, failedPlaceholder.id)),
      ),
    ).toBe("P0001");
    await safely(() =>
      activeDb()
        .update(trackVersions)
        .set({ label: "Preserved failed placeholder" })
        .where(eq(trackVersions.id, failedPlaceholder.id)),
    );

    const [livePlaceholder] = await safely(() =>
      activeDb()
        .insert(trackVersions)
        .values({ trackId: track.id, purchaseId, producerId, label: "Live placeholder" })
        .returning({ id: trackVersions.id }),
    );
    if (!livePlaceholder) throw new Error("SK-90 live placeholder was not created");
    const completedKey = `sk90-isolated/${fixtureSuffix}/${randomUUID()}`;
    const completedEtag = `etag-${randomUUID()}`;
    const completedSize = 456;
    const completedFingerprint = createAudioIdentityFingerprint({
      key: completedKey,
      objectEtag: completedEtag,
      sizeBytes: completedSize,
    });
    await safely(() =>
      activeDb()
        .update(trackVersions)
        .set({
          audioUrl: `/api/audio/sk90/${randomUUID()}`,
          audioR2Key: completedKey,
          sizeBytes: completedSize,
          audioObjectEtag: completedEtag,
          audioIdentityFingerprint: completedFingerprint,
        })
        .where(eq(trackVersions.id, livePlaceholder.id)),
    );
    expect(
      await rejectedPostgresCode(() =>
        activeDb()
          .update(trackVersions)
          .set({ audioR2Key: `${completedKey}-changed` })
          .where(eq(trackVersions.id, livePlaceholder.id)),
      ),
    ).toBe("P0001");

    const completedDeletedAt = new Date("2035-01-04T03:04:05.000Z");
    await safely(() =>
      activeDb()
        .update(trackVersions)
        .set({ audioDeletedAt: completedDeletedAt })
        .where(eq(trackVersions.id, livePlaceholder.id)),
    );
    expect(
      await rejectedPostgresCode(() =>
        activeDb()
          .update(trackVersions)
          .set({ audioDeletedAt: null })
          .where(eq(trackVersions.id, livePlaceholder.id)),
      ),
    ).toBe("P0001");

    const [simultaneousPlaceholder] = await safely(() =>
      activeDb()
        .insert(trackVersions)
        .values({ trackId: track.id, purchaseId, producerId, label: "Simultaneous placeholder" })
        .returning({ id: trackVersions.id }),
    );
    if (!simultaneousPlaceholder) {
      throw new Error("SK-90 simultaneous placeholder was not created");
    }
    expect(
      await rejectedPostgresCode(() =>
        activeDb()
          .update(trackVersions)
          .set({
            audioUrl: `/api/audio/sk90/${randomUUID()}`,
            audioR2Key: completedKey,
            sizeBytes: completedSize,
            audioObjectEtag: completedEtag,
            audioIdentityFingerprint: completedFingerprint,
            audioDeletedAt: completedDeletedAt,
          })
          .where(eq(trackVersions.id, simultaneousPlaceholder.id)),
      ),
    ).toBe("P0001");
  });

  it("rejects every cross-producer notification reference", async () => {
    const purchaseId = await createPaidPurchase();
    const productId = await createProduct();
    const requestId = await createPurchaseRequest(productId, projectId);
    const [track] = await safely(() =>
      activeDb()
        .insert(projectTracks)
        .values({ projectId, purchaseId, title: "SK-90 notification track" })
        .returning({ id: projectTracks.id }),
    );
    if (!track) throw new Error("SK-90 notification track fixture was not created");
    const [version] = await safely(() =>
      activeDb()
        .insert(trackVersions)
        .values({ trackId: track.id, purchaseId, producerId, label: "Notification V1" })
        .returning({ id: trackVersions.id }),
    );
    if (!version) throw new Error("SK-90 notification version fixture was not created");
    const [comment] = await safely(() =>
      activeDb()
        .insert(trackComments)
        .values({
          versionId: version.id,
          producerId,
          authorName: "SK-90 Artist Fixture",
          authorEmail: `artist-${fixtureSuffix}@example.invalid`,
          body: "SK-90 notification fixture",
          timestampMs: 0,
        })
        .returning({ id: trackComments.id }),
    );
    if (!comment) throw new Error("SK-90 notification comment fixture was not created");
    const [allowance] = await safely(() =>
      activeDb()
        .insert(purchaseSessionAllowances)
        .values({
          purchaseId,
          producerId,
          kind: "fixed",
          sessionLimit: 1,
          durationMin: 60,
          locationType: "studio",
          bufferMinutes: 0,
          minLeadHours: 0,
        })
        .returning({ id: purchaseSessionAllowances.id }),
    );
    if (!allowance) throw new Error("SK-90 notification allowance fixture was not created");
    const bookingOperationKey = `sk90-notification-booking-${fixtureSuffix}`;
    const bookingOperationDigest = `digest-sk90-notification-booking-${fixtureSuffix}`;
    const [booking] = await safely(() =>
      activeDb()
        .insert(bookings)
        .values({
          producerId,
          projectId,
          purchaseId,
          sessionAllowanceId: allowance.id,
          artistName: "SK-90 Artist Fixture",
          artistEmail: `artist-${fixtureSuffix}@example.invalid`,
          startsAt: new Date("2035-03-01T10:00:00.000Z"),
          durationMin: 60,
          operationKey: bookingOperationKey,
          operationDigest: bookingOperationDigest,
        })
        .returning({ id: bookings.id }),
    );
    if (!booking) throw new Error("SK-90 notification booking fixture was not created");
    expect(
      await rejectedPostgresCode(() =>
        activeDb()
          .update(bookings)
          .set({ operationDigest: `${bookingOperationDigest}-changed` })
          .where(eq(bookings.id, booking.id)),
      ),
    ).toBe("P0001");
    expect(
      await rejectedPostgresCode(() =>
        activeDb()
          .update(bookings)
          .set({
            startsAt: new Date("2035-03-01T11:00:00.000Z"),
            durationMin: 90,
          })
          .where(eq(bookings.id, booking.id)),
      ),
    ).toBe("P0001");
    expect(
      await rejectedPostgresCode(() =>
        activeDb()
          .insert(bookings)
          .values({
            producerId,
            projectId,
            purchaseId,
            sessionAllowanceId: allowance.id,
            artistName: "SK-90 Artist Fixture",
            artistEmail: `artist-${fixtureSuffix}@example.invalid`,
            startsAt: new Date("2035-03-01T12:00:00.000Z"),
            durationMin: 60,
            operationKey: bookingOperationKey,
            operationDigest: `${bookingOperationDigest}-different-command`,
          }),
      ),
    ).toBe("23505");
    const [otherProducer] = await safely(() =>
      activeDb()
        .insert(producers)
        .values({
          clerkUserId: `sk90-other-${fixtureSuffix}`,
          email: `sk90-other-${fixtureSuffix}@example.invalid`,
          slug: `sk90-other-${fixtureSuffix}`,
        })
        .returning({ id: producers.id }),
    );
    if (!otherProducer) throw new Error("SK-90 other-producer fixture was not created");

    for (const reference of [
      { projectId },
      { trackVersionId: version.id },
      { commentId: comment.id },
      { bookingId: booking.id },
      { purchaseRequestId: requestId },
      { purchaseId },
    ]) {
      expect(
        await rejectedPostgresCode(() =>
          activeDb()
            .insert(notifications)
            .values({
              producerId: otherProducer.id,
              kind: "comment_created",
              title: "SK-90 cross-producer fixture",
              ...reference,
            }),
        ),
      ).toBe("23503");
    }

    await safely(() =>
      activeDb().insert(notifications).values({
        producerId,
        kind: "comment_created",
        title: "SK-90 same-producer fixture",
        commentId: comment.id,
      }),
    );
  });

  it("allows one winner for concurrent duplicate purchase operation keys", async () => {
    const operationKey = `concurrent-${randomUUID()}`;
    const results = await Promise.allSettled([
      insertPaidPurchaseWithSchedule({
        totalCents: 100,
        paymentPlanKind: "full",
        operationKey,
      }),
      insertPaidPurchaseWithSchedule({
        totalCents: 100,
        paymentPlanKind: "full",
        operationKey,
      }),
    ]);

    const statuses = results.map((result) => result.status);
    const rejectedCodes = results
      .filter((result): result is PromiseRejectedResult => result.status === "rejected")
      .map((result) => postgresErrorCode(result.reason));
    expect(statuses.filter((status) => status === "fulfilled")).toHaveLength(1);
    expect(rejectedCodes).toEqual(["23505"]);
  });

  it("rejects cross-purchase and cross-installment proof replacements", async () => {
    const firstPurchaseId = await createPaidPurchase();
    const secondPurchaseId = await createPaidPurchase();
    const firstInstallmentId = await createInstallment(firstPurchaseId, 1);
    const secondInstallmentId = await createInstallment(firstPurchaseId, 2);
    const otherPurchaseInstallmentId = await createInstallment(secondPurchaseId, 1);

    const [originalProof] = await safely(() =>
      activeDb()
        .insert(paymentProofs)
        .values(proofValues({ purchaseId: firstPurchaseId, installmentId: firstInstallmentId }))
        .returning({ id: paymentProofs.id }),
    );
    if (!originalProof) throw new Error("SK-90 proof fixture was not created");

    expect(
      await rejectedPostgresCode(() =>
        activeDb()
          .insert(paymentProofs)
          .values(
            proofValues({
              purchaseId: secondPurchaseId,
              installmentId: otherPurchaseInstallmentId,
              replacesProofId: originalProof.id,
            }),
          ),
      ),
    ).toBe("23503");

    expect(
      await rejectedPostgresCode(() =>
        activeDb()
          .insert(paymentProofs)
          .values(
            proofValues({
              purchaseId: firstPurchaseId,
              installmentId: secondInstallmentId,
              replacesProofId: originalProof.id,
            }),
          ),
      ),
    ).toBe("23503");

    const [replacement] = await safely(() =>
      activeDb()
        .insert(paymentProofs)
        .values(
          proofValues({
            purchaseId: firstPurchaseId,
            installmentId: firstInstallmentId,
            replacesProofId: originalProof.id,
            status: "pending",
          }),
        )
        .returning({ id: paymentProofs.id }),
    );
    expect(replacement).toBeDefined();
  });

  it("rejects a payment proof that replaces itself", async () => {
    const purchaseId = await createPaidPurchase();
    const installmentId = await createInstallment(purchaseId, 1);
    const proofId = randomUUID();

    expect(
      await rejectedPostgresCode(() =>
        activeDb()
          .insert(paymentProofs)
          .values(
            proofValues({
              id: proofId,
              purchaseId,
              installmentId,
              replacesProofId: proofId,
            }),
          ),
      ),
    ).toBe("23514");
  });

  it("enforces proof status shape, terminal history, and rejected-only replacement", async () => {
    const purchaseId = await createPaidPurchase();
    const installmentId = await createInstallment(purchaseId, 1);

    expect(
      await rejectedPostgresCode(() =>
        activeDb()
          .insert(paymentProofs)
          .values({
            ...proofValues({ purchaseId, installmentId }),
            rejectionNote: " ",
          }),
      ),
    ).toBe("23514");

    const [confirmedProof] = await safely(() =>
      activeDb()
        .insert(paymentProofs)
        .values(proofValues({ purchaseId, installmentId, status: "pending" }))
        .returning({ id: paymentProofs.id }),
    );
    if (!confirmedProof) throw new Error("SK-90 pending proof fixture was not created");
    await safely(() =>
      activeDb()
        .update(paymentProofs)
        .set({ status: "confirmed", confirmedAt: acceptedAt })
        .where(eq(paymentProofs.id, confirmedProof.id)),
    );
    expect(
      await rejectedPostgresCode(() =>
        activeDb()
          .update(paymentProofs)
          .set({
            status: "rejected",
            confirmedAt: null,
            rejectedAt: acceptedAt,
            rejectionNote: "x",
          })
          .where(eq(paymentProofs.id, confirmedProof.id)),
      ),
    ).toBe("P0001");
    expect(
      await rejectedPostgresCode(() =>
        activeDb()
          .insert(paymentProofs)
          .values(
            proofValues({
              purchaseId,
              installmentId,
              replacesProofId: confirmedProof.id,
              status: "pending",
            }),
          ),
      ),
    ).toBe("23514");

    const [rejectedProof] = await safely(() =>
      activeDb()
        .insert(paymentProofs)
        .values(proofValues({ purchaseId, installmentId }))
        .returning({ id: paymentProofs.id }),
    );
    if (!rejectedProof) throw new Error("SK-90 rejected proof fixture was not created");
    await safely(() =>
      activeDb()
        .insert(paymentProofs)
        .values(
          proofValues({
            purchaseId,
            installmentId,
            replacesProofId: rejectedProof.id,
            status: "pending",
          }),
        ),
    );
    expect(
      await rejectedPostgresCode(() =>
        activeDb()
          .insert(paymentProofs)
          .values(
            proofValues({
              purchaseId,
              installmentId,
              replacesProofId: rejectedProof.id,
              status: "pending",
            }),
          ),
      ),
    ).toBe("23505");
  });
});
