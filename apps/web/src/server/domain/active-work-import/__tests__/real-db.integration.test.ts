import { randomUUID } from "node:crypto";

import {
  activeWorkImportRows,
  activeWorkImportSetupOperations,
  and,
  clientContacts,
  clientInvitationEmailDeliveries,
  createDb,
  eq,
  notifications,
  paymentProofs,
  producers,
  projectTracks,
  projects,
  purchaseImportAttestations,
  purchaseInstallments,
  purchasePayments,
  purchases,
  sql,
  type Db,
} from "@skitza/db";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { emailHashFor } from "~/server/artist/identity";
import {
  clientInvitationDeliveryRepository,
  loadCurrentClientInvitationEvidence,
  loadCurrentClientInvitationStates,
  reserveActiveWorkImportClientInvitationEmail,
  reserveClientInvitationEmail,
} from "../../client-invitations/db";
import { deliverClientInvitation } from "../../client-invitations/service";
import { purchaseLedgerRepository } from "../../purchase-ledger/db";
import { readPurchaseLedger } from "../../purchase-ledger/service";
import { digestCommercialSnapshot } from "../../purchases/policy";
import {
  assessStoredActiveWorkImportRow,
  cleanupUnpersistedActiveWorkImportProof,
  createActiveWorkImportBatch,
  deleteActiveWorkImportRow,
  loadLatestOpenActiveWorkImportBatch,
  materializeActiveWorkImportRowTransaction,
  saveActiveWorkImportRow,
} from "../db";
import type { ActiveWorkImportProofCapability } from "../proof-capability";
import {
  activeWorkImportCreationDigest,
  assessActiveWorkImportDraft,
  type NormalizedActiveWorkImport,
} from "../service";
import {
  activeWorkImportSetupOperationDigest,
  reserveActiveWorkImportSetupOperation,
} from "../setup";
import { confirmedActiveWorkImportTestDatabaseUrl } from "./real-db-target-gate";

const testDatabaseUrl = confirmedActiveWorkImportTestDatabaseUrl(process.env);
const describeWithConfirmedDatabase = testDatabaseUrl ? describe.sequential : describe.skip;
if (testDatabaseUrl) vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

function historicalDraft(
  input: Readonly<{
    email: string;
    name?: string;
    phone?: string | null;
    existingClientId?: string;
    title: string;
    payments?: readonly Record<string, unknown>[];
  }>,
): Record<string, unknown> {
  return {
    client: {
      name: input.name ?? "Imported Artist",
      email: input.email,
      phone: input.phone ?? null,
      ...(input.existingClientId ? { existingClientId: input.existingClientId } : {}),
    },
    project: { title: input.title, deadlineAt: null },
    agreement: {
      name: "Existing production agreement",
      deliverables: ["Produced master"],
      rights: ["Artist owns the released master"],
      agreementText: "The existing off-platform agreement remains the source of truth.",
      subtotalCents: 10_000,
      taxMode: "tax_free",
      taxRatePct: 0,
      taxAmountCents: 0,
      totalCents: 10_000,
      currency: "USD",
      includedSongSpaces: 1,
      plan: { kind: "full" },
      revisionRule: null,
      royaltyTerms: null,
    },
    payments: input.payments ?? [],
  };
}

function ready(draft: Record<string, unknown>, asOf: Date): NormalizedActiveWorkImport {
  const assessment = assessActiveWorkImportDraft(draft, asOf);
  if (assessment.state !== "ready") {
    throw new Error("SK-255 real database fixture did not assess as Ready");
  }
  return assessment.normalized;
}

describeWithConfirmedDatabase("SK-255 active work materialization — confirmed test target", () => {
  const suffix = randomUUID();
  const importedAt = new Date("2035-08-20T12:00:00.000Z");
  const producerClerkUserId = `sk255-producer-${suffix}`;
  const otherProducerClerkUserId = `sk255-other-${suffix}`;
  let db: Db | null = null;
  let producerId = "";
  let otherProducerId = "";

  function activeDb(): Db {
    if (!db) throw new Error("SK-255 confirmed test database was not initialized");
    return db;
  }

  beforeAll(async () => {
    if (!testDatabaseUrl) throw new Error("SK-255 confirmed test target is missing");
    db = createDb(testDatabaseUrl);
    const marker = await activeDb().execute<{
      tables: number;
      triggers: number;
    }>(sql`
      select
        (
          select count(*)::int
          from pg_class
          where oid in (
            to_regclass('public.active_work_import_batches'),
            to_regclass('public.active_work_import_rows'),
            to_regclass('public.active_work_import_setup_operations'),
            to_regclass('public.purchase_import_attestations'),
            to_regclass('public.client_invitation_email_deliveries')
          )
        ) as "tables",
        (
          select count(*)::int
          from pg_trigger trigger_row
          inner join pg_class trigger_table
            on trigger_table.oid = trigger_row.tgrelid
          inner join pg_namespace table_schema
            on table_schema.oid = trigger_table.relnamespace
          inner join pg_proc trigger_function
            on trigger_function.oid = trigger_row.tgfoid
          inner join pg_namespace function_schema
            on function_schema.oid = trigger_function.pronamespace
          where table_schema.nspname = 'public'
            and function_schema.nspname = 'public'
            and (
              trigger_table.relname,
              trigger_row.tgname,
              trigger_function.proname
            ) in (
              (
                'purchase_import_attestations',
                'purchase_import_attestations_validate_purchase',
                'validate_purchase_import_attestation'
              ),
              (
                'purchase_installments',
                'purchase_installments_reject_accepted_append',
                'reject_purchase_installment_after_acceptance'
              )
            )
            and trigger_row.tgenabled = 'O'
            and not trigger_row.tgisinternal
        ) as "triggers"
    `);
    const foundationMarker = marker.rows[0];
    if (!foundationMarker || foundationMarker.tables !== 5 || foundationMarker.triggers !== 2) {
      throw new Error("SK-255 confirmed test target is missing the audited foundation");
    }
    const inserted = await activeDb()
      .insert(producers)
      .values([
        {
          clerkUserId: producerClerkUserId,
          email: `producer-${suffix}@example.invalid`,
          slug: `sk255-producer-${suffix}`,
          displayName: "SK-255 Studio",
          timezone: "UTC",
        },
        {
          clerkUserId: otherProducerClerkUserId,
          email: `other-${suffix}@example.invalid`,
          slug: `sk255-other-${suffix}`,
          displayName: "Other Studio",
          timezone: "UTC",
        },
      ])
      .returning({ id: producers.id, clerkUserId: producers.clerkUserId });
    producerId = inserted.find((row) => row.clerkUserId === producerClerkUserId)?.id ?? "";
    otherProducerId = inserted.find((row) => row.clerkUserId !== producerClerkUserId)?.id ?? "";
    if (!producerId || !otherProducerId) throw new Error("SK-255 producer fixtures were not saved");
  });

  it("durably binds one bulk setup key to its exact reviewed selections", async () => {
    const [batchAResult, batchBResult] = await Promise.all([
      createActiveWorkImportBatch(activeDb(), {
        producerId,
        clerkUserId: producerClerkUserId,
        operationKey: `setup-operation-batch-a-${suffix}`,
      }),
      createActiveWorkImportBatch(activeDb(), {
        producerId,
        clerkUserId: producerClerkUserId,
        operationKey: `setup-operation-batch-b-${suffix}`,
      }),
    ]);
    const batchA = batchAResult.batch;
    const batchB = batchBResult.batch;
    const bulkOperationKey = `finish-setup-${suffix}`;
    const expectedSetupDigest = `sha256:${"c".repeat(64)}`;
    const selectedClientId = randomUUID();
    const selectedInstallmentId = randomUUID();
    const operationDigestA = activeWorkImportSetupOperationDigest({
      batchId: batchA.id,
      expectedSetupDigest,
      selectedClientContactIds: [selectedClientId, selectedClientId],
      mandatoryInstallmentIds: [selectedInstallmentId],
    });
    const reservation = {
      producerId,
      batchId: batchA.id,
      operationKey: bulkOperationKey,
      operationDigest: operationDigestA,
      requestedByClerkUserId: producerClerkUserId,
      requestedAt: new Date("2035-01-01T10:00:00.000Z"),
    };

    await expect(reserveActiveWorkImportSetupOperation(activeDb(), reservation)).resolves.toEqual({
      created: true,
    });
    await expect(reserveActiveWorkImportSetupOperation(activeDb(), reservation)).resolves.toEqual({
      created: false,
    });

    const beforeConflict = await activeDb()
      .select({ id: activeWorkImportSetupOperations.id })
      .from(activeWorkImportSetupOperations)
      .where(
        and(
          eq(activeWorkImportSetupOperations.producerId, producerId),
          eq(activeWorkImportSetupOperations.batchId, batchA.id),
          eq(activeWorkImportSetupOperations.operationKey, bulkOperationKey),
        ),
      );
    expect(beforeConflict).toHaveLength(1);

    const changedDigest = activeWorkImportSetupOperationDigest({
      batchId: batchA.id,
      expectedSetupDigest,
      selectedClientContactIds: [],
      mandatoryInstallmentIds: [selectedInstallmentId],
    });
    await expect(
      reserveActiveWorkImportSetupOperation(activeDb(), {
        ...reservation,
        operationDigest: changedDigest,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });

    const afterConflict = await activeDb()
      .select({ id: activeWorkImportSetupOperations.id })
      .from(activeWorkImportSetupOperations)
      .where(
        and(
          eq(activeWorkImportSetupOperations.producerId, producerId),
          eq(activeWorkImportSetupOperations.batchId, batchA.id),
          eq(activeWorkImportSetupOperations.operationKey, bulkOperationKey),
        ),
      );
    expect(afterConflict).toEqual(beforeConflict);

    await expect(
      reserveActiveWorkImportSetupOperation(activeDb(), {
        ...reservation,
        producerId: otherProducerId,
        requestedByClerkUserId: otherProducerClerkUserId,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      reserveActiveWorkImportSetupOperation(activeDb(), {
        ...reservation,
        requestedByClerkUserId: otherProducerClerkUserId,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    const operationDigestB = activeWorkImportSetupOperationDigest({
      batchId: batchB.id,
      expectedSetupDigest,
      selectedClientContactIds: [],
      mandatoryInstallmentIds: [],
    });
    await expect(
      reserveActiveWorkImportSetupOperation(activeDb(), {
        ...reservation,
        batchId: batchB.id,
        operationDigest: operationDigestB,
      }),
    ).resolves.toEqual({ created: true });
    const separatelyScoped = await activeDb()
      .select({ batchId: activeWorkImportSetupOperations.batchId })
      .from(activeWorkImportSetupOperations)
      .where(
        and(
          eq(activeWorkImportSetupOperations.producerId, producerId),
          eq(activeWorkImportSetupOperations.operationKey, bulkOperationKey),
        ),
      );
    expect(new Set(separatelyScoped.map((row) => row.batchId))).toEqual(
      new Set([batchA.id, batchB.id]),
    );
  });

  it("persists invitation claim, provider acceptance, idempotent retry, and current-email setup eligibility", async () => {
    const originalEmail = `invite-${suffix}@example.invalid`;
    const [client] = await activeDb()
      .insert(clientContacts)
      .values({
        producerId,
        emailHash: emailHashFor(originalEmail),
        email: originalEmail,
        name: "Invitation Client",
      })
      .returning();
    if (!client) throw new Error("SK-255 invitation Client fixture was not saved");
    const operationKey = `invite-operation-${suffix}`;
    const requestedAt = new Date("2035-02-01T10:00:00.000Z");
    const acceptedAt = new Date("2035-02-01T10:00:01.000Z");
    const firstReservation = await reserveClientInvitationEmail(activeDb(), {
      producerId,
      clientContactId: client.id,
      operationKey,
      requestedByClerkUserId: producerClerkUserId,
      siteUrl: "https://skitza.test",
      requestedAt,
    });
    expect(
      (
        await loadCurrentClientInvitationStates(activeDb(), {
          producerId,
          clientContactIds: [client.id],
        })
      ).get(client.id),
    ).toMatchObject({ presentationState: "requested", providerAcceptedAt: null });
    let providerCalls = 0;
    const send = () => {
      providerCalls += 1;
      return Promise.resolve(`provider-${suffix}`);
    };
    const first = await deliverClientInvitation(
      clientInvitationDeliveryRepository(activeDb()),
      send,
      firstReservation.delivery,
      requestedAt,
      () => acceptedAt,
    );
    expect(first).toMatchObject({ state: "provider_accepted", created: true });
    const replayReservation = await reserveClientInvitationEmail(activeDb(), {
      producerId,
      clientContactId: client.id,
      operationKey,
      requestedByClerkUserId: producerClerkUserId,
      siteUrl: "https://skitza.test",
      requestedAt,
    });
    const replay = await deliverClientInvitation(
      clientInvitationDeliveryRepository(activeDb()),
      send,
      replayReservation.delivery,
      new Date(requestedAt.getTime() + 2_000),
      () => new Date(acceptedAt.getTime() + 2_000),
    );
    expect(replay).toMatchObject({ state: "provider_accepted", created: false });
    expect(providerCalls).toBe(1);
    expect(
      (
        await loadCurrentClientInvitationEvidence(activeDb(), {
          producerId,
          clientContactIds: [client.id],
        })
      ).get(client.id),
    ).toEqual(acceptedAt);
    expect(
      (
        await loadCurrentClientInvitationStates(activeDb(), {
          producerId,
          clientContactIds: [client.id],
        })
      ).get(client.id),
    ).toMatchObject({
      presentationState: "provider_accepted",
      providerAcceptedAt: acceptedAt,
    });
    expect(
      await reserveActiveWorkImportClientInvitationEmail(activeDb(), {
        producerId,
        clientContactId: client.id,
        operationKey: `bulk-invite-${suffix}`,
        requestedByClerkUserId: producerClerkUserId,
        siteUrl: "https://skitza.test",
        requestedAt: new Date(requestedAt.getTime() + 3_000),
        expectedEmailHash: client.emailHash,
      }),
    ).toEqual({ state: "provider_accepted", providerAcceptedAt: acceptedAt });

    const correctedEmail = `corrected-${suffix}@example.invalid`;
    const correctedHash = emailHashFor(correctedEmail);
    await activeDb()
      .update(clientContacts)
      .set({ email: correctedEmail, emailHash: correctedHash })
      .where(and(eq(clientContacts.id, client.id), eq(clientContacts.producerId, producerId)));
    expect(
      (
        await loadCurrentClientInvitationEvidence(activeDb(), {
          producerId,
          clientContactIds: [client.id],
        })
      ).has(client.id),
    ).toBe(false);
    expect(
      (
        await loadCurrentClientInvitationStates(activeDb(), {
          producerId,
          clientContactIds: [client.id],
        })
      ).has(client.id),
    ).toBe(false);
    const correctedReservation = await reserveActiveWorkImportClientInvitationEmail(activeDb(), {
      producerId,
      clientContactId: client.id,
      operationKey: `bulk-corrected-${suffix}`,
      requestedByClerkUserId: producerClerkUserId,
      siteUrl: "https://skitza.test",
      requestedAt: new Date(requestedAt.getTime() + 4_000),
      expectedEmailHash: correctedHash,
    });
    expect(correctedReservation.state).toBe("reserved");
    const stored = await activeDb()
      .select()
      .from(clientInvitationEmailDeliveries)
      .where(
        and(
          eq(clientInvitationEmailDeliveries.producerId, producerId),
          eq(clientInvitationEmailDeliveries.clientContactId, client.id),
        ),
      );
    expect(stored).toHaveLength(2);
  });

  it("resumes normal invitation rows after reload with one frozen provider key", async () => {
    const baseTime = new Date("2035-03-01T10:00:00.000Z");
    async function createInviteClient(label: string) {
      const email = `${label}-${suffix}@example.invalid`;
      const [client] = await activeDb()
        .insert(clientContacts)
        .values({
          producerId,
          emailHash: emailHashFor(email),
          email,
          name: `Invite ${label}`,
        })
        .returning();
      if (!client) throw new Error(`SK-255 ${label} invitation Client was not saved`);
      return client;
    }

    const reservedClient = await createInviteClient("reserved-reload");
    const reserved = await reserveClientInvitationEmail(activeDb(), {
      producerId,
      clientContactId: reservedClient.id,
      operationKey: `reserved-before-reload-${suffix}`,
      requestedByClerkUserId: producerClerkUserId,
      siteUrl: "https://skitza.test",
      requestedAt: baseTime,
    });
    const reservedReload = await reserveClientInvitationEmail(activeDb(), {
      producerId,
      clientContactId: reservedClient.id,
      operationKey: `reserved-new-ui-key-${suffix}`,
      requestedByClerkUserId: producerClerkUserId,
      siteUrl: "https://skitza.test",
      requestedAt: new Date(baseTime.getTime() + 1_000),
    });
    expect(reservedReload).toMatchObject({
      created: false,
      delivery: {
        id: reserved.delivery.id,
        operationKey: reserved.delivery.operationKey,
        providerIdempotencyKey: reserved.delivery.providerIdempotencyKey,
      },
    });
    const setupReload = await reserveActiveWorkImportClientInvitationEmail(activeDb(), {
      producerId,
      clientContactId: reservedClient.id,
      operationKey: `active-setup-after-reload-${suffix}`,
      requestedByClerkUserId: producerClerkUserId,
      siteUrl: "https://skitza.test",
      requestedAt: new Date(baseTime.getTime() + 2_000),
      expectedEmailHash: reservedClient.emailHash,
    });
    expect(setupReload).toMatchObject({
      state: "reserved",
      delivery: {
        id: reserved.delivery.id,
        operationKey: reserved.delivery.operationKey,
        providerIdempotencyKey: reserved.delivery.providerIdempotencyKey,
      },
    });
    if (setupReload.state !== "reserved") {
      throw new Error("SK-255 setup reload did not resume the frozen delivery");
    }
    let setupProviderCalls = 0;
    await deliverClientInvitation(
      clientInvitationDeliveryRepository(activeDb()),
      () => {
        setupProviderCalls += 1;
        return Promise.resolve(`provider-setup-reload-${suffix}`);
      },
      setupReload.delivery,
      new Date(baseTime.getTime() + 2_000),
      () => new Date(baseTime.getTime() + 3_000),
    );
    expect(setupProviderCalls).toBe(1);

    const staleClient = await createInviteClient("stale-sending-reload");
    const staleReserved = await reserveClientInvitationEmail(activeDb(), {
      producerId,
      clientContactId: staleClient.id,
      operationKey: `stale-before-reload-${suffix}`,
      requestedByClerkUserId: producerClerkUserId,
      siteUrl: "https://skitza.test",
      requestedAt: baseTime,
    });
    const deliveryRepository = clientInvitationDeliveryRepository(activeDb());
    const staleClaim = await deliveryRepository.claimDelivery({
      producerId,
      clientContactId: staleClient.id,
      operationKey: staleReserved.delivery.operationKey,
      claimToken: `stale-claim-${suffix}`,
      claimedAt: baseTime,
      claimUntil: new Date(baseTime.getTime() + 5 * 60_000),
      newProviderDedupeExpiresAt: new Date(baseTime.getTime() + 24 * 60 * 60_000),
    });
    expect(staleClaim.state).toBe("claimed");
    const staleReload = await reserveClientInvitationEmail(activeDb(), {
      producerId,
      clientContactId: staleClient.id,
      operationKey: `stale-new-ui-key-${suffix}`,
      requestedByClerkUserId: producerClerkUserId,
      siteUrl: "https://skitza.test",
      requestedAt: new Date(baseTime.getTime() + 6 * 60_000),
    });
    expect(staleReload.delivery).toMatchObject({
      id: staleReserved.delivery.id,
      operationKey: staleReserved.delivery.operationKey,
      providerIdempotencyKey: staleReserved.delivery.providerIdempotencyKey,
    });
    const staleProviderKeys: string[] = [];
    await deliverClientInvitation(
      deliveryRepository,
      ({ idempotencyKey }) => {
        staleProviderKeys.push(idempotencyKey);
        return Promise.resolve(`provider-stale-${suffix}`);
      },
      staleReload.delivery,
      new Date(baseTime.getTime() + 6 * 60_000),
      () => new Date(baseTime.getTime() + 6 * 60_000 + 1_000),
    );
    expect(staleProviderKeys).toEqual([staleReserved.delivery.providerIdempotencyKey]);

    const failedClient = await createInviteClient("failed-reload");
    const failedReserved = await reserveClientInvitationEmail(activeDb(), {
      producerId,
      clientContactId: failedClient.id,
      operationKey: `failed-before-reload-${suffix}`,
      requestedByClerkUserId: producerClerkUserId,
      siteUrl: "https://skitza.test",
      requestedAt: baseTime,
    });
    const failedProviderKeys: string[] = [];
    await expect(
      deliverClientInvitation(
        deliveryRepository,
        ({ idempotencyKey }) => {
          failedProviderKeys.push(idempotencyKey);
          return Promise.reject(new Error("synthetic provider failure"));
        },
        failedReserved.delivery,
        baseTime,
        () => new Date(baseTime.getTime() + 1_000),
      ),
    ).rejects.toThrow("synthetic provider failure");
    expect(
      (
        await loadCurrentClientInvitationStates(activeDb(), {
          producerId,
          clientContactIds: [failedClient.id],
        })
      ).get(failedClient.id)?.presentationState,
    ).toBe("failed");
    const failedReload = await reserveClientInvitationEmail(activeDb(), {
      producerId,
      clientContactId: failedClient.id,
      operationKey: `failed-new-ui-key-${suffix}`,
      requestedByClerkUserId: producerClerkUserId,
      siteUrl: "https://skitza.test",
      requestedAt: new Date(baseTime.getTime() + 60_000),
    });
    await deliverClientInvitation(
      deliveryRepository,
      ({ idempotencyKey }) => {
        failedProviderKeys.push(idempotencyKey);
        return Promise.resolve(`provider-failed-retry-${suffix}`);
      },
      failedReload.delivery,
      new Date(baseTime.getTime() + 60_000),
      () => new Date(baseTime.getTime() + 61_000),
    );
    expect(new Set(failedProviderKeys)).toEqual(
      new Set([failedReserved.delivery.providerIdempotencyKey]),
    );

    const expiredClient = await createInviteClient("expired-setup-reload");
    const expiredReserved = await reserveClientInvitationEmail(activeDb(), {
      producerId,
      clientContactId: expiredClient.id,
      operationKey: `expired-before-reload-${suffix}`,
      requestedByClerkUserId: producerClerkUserId,
      siteUrl: "https://skitza.test",
      requestedAt: baseTime,
    });
    await expect(
      deliverClientInvitation(
        deliveryRepository,
        () => Promise.reject(new Error("synthetic expiry provider failure")),
        expiredReserved.delivery,
        baseTime,
        () => new Date(baseTime.getTime() + 1_000),
      ),
    ).rejects.toThrow("synthetic expiry provider failure");
    const afterDedupe = new Date(baseTime.getTime() + 24 * 60 * 60_000);
    const expiredSetup = await reserveActiveWorkImportClientInvitationEmail(activeDb(), {
      producerId,
      clientContactId: expiredClient.id,
      operationKey: `active-setup-after-dedupe-${suffix}`,
      requestedByClerkUserId: producerClerkUserId,
      siteUrl: "https://skitza.test",
      requestedAt: afterDedupe,
      expectedEmailHash: expiredClient.emailHash,
    });
    expect(expiredSetup).toMatchObject({
      state: "reserved",
      delivery: {
        operationKey: `active-setup-after-dedupe-${suffix}`,
      },
    });
    if (expiredSetup.state !== "reserved") {
      throw new Error("SK-255 setup did not create a post-dedupe delivery");
    }
    expect(expiredSetup.delivery.id).not.toBe(expiredReserved.delivery.id);

    for (const client of [reservedClient, staleClient, failedClient]) {
      const deliveries = await activeDb()
        .select()
        .from(clientInvitationEmailDeliveries)
        .where(
          and(
            eq(clientInvitationEmailDeliveries.producerId, producerId),
            eq(clientInvitationEmailDeliveries.clientContactId, client.id),
          ),
        );
      expect(deliveries).toHaveLength(1);
    }
  });

  it("requires explicit reuse when a normalized email already belongs to a Client", async () => {
    const email = `explicit-reuse-${suffix}@example.invalid`;
    const [existingClient] = await activeDb()
      .insert(clientContacts)
      .values({
        producerId,
        emailHash: emailHashFor(email),
        email,
        name: "Existing saved Client",
        phone: "+1 555 KEEP",
      })
      .returning();
    if (!existingClient) throw new Error("SK-255 reuse Client fixture was not saved");
    const batch = await createActiveWorkImportBatch(activeDb(), {
      producerId,
      clerkUserId: producerClerkUserId,
      operationKey: `explicit-reuse-batch-${suffix}`,
      now: importedAt,
    });
    const draft = historicalDraft({
      email: email.toUpperCase(),
      name: "Unreviewed replacement",
      phone: "+1 555 REPLACE",
      title: `Explicit reuse project ${suffix}`,
    });
    const saved = await saveActiveWorkImportRow(activeDb(), {
      producerId,
      batchId: batch.batch.id,
      rowOperationKey: `explicit-reuse-row-${suffix}`,
      expectedRevision: null,
      draftPayload: draft,
      now: importedAt,
    });

    const needsInfo = await assessStoredActiveWorkImportRow(activeDb(), {
      producerId,
      batchId: batch.batch.id,
      rowId: saved.row.id,
      asOf: importedAt,
    });

    expect(needsInfo).toEqual({
      state: "needs_info",
      reasons: [
        {
          code: "existing_client_reuse_required",
          field: "client.existingClientId",
          message:
            "This email is already a Client. Choose that Client to keep their saved details.",
        },
      ],
    });
  });

  it("requires a producer-archived Client to be restored and blocks materialization", async () => {
    const email = `archived-client-${suffix}@example.invalid`;
    const archivedAt = new Date("2035-01-15T12:00:00.000Z");
    const [archivedClient] = await activeDb()
      .insert(clientContacts)
      .values({
        producerId,
        emailHash: emailHashFor(email),
        email,
        name: "Archived Client",
        producerArchivedAt: archivedAt,
      })
      .returning();
    if (!archivedClient) throw new Error("SK-255 archived Client fixture was not saved");
    const batch = await createActiveWorkImportBatch(activeDb(), {
      producerId,
      clerkUserId: producerClerkUserId,
      operationKey: `archived-client-batch-${suffix}`,
      now: importedAt,
    });
    const unselectedDraft = historicalDraft({
      email,
      title: `Archived unselected ${suffix}`,
    });
    const selectedDraft = historicalDraft({
      email,
      existingClientId: archivedClient.id,
      title: `Archived selected ${suffix}`,
    });
    const [unselectedRow, selectedRow] = await Promise.all([
      saveActiveWorkImportRow(activeDb(), {
        producerId,
        batchId: batch.batch.id,
        rowOperationKey: `archived-unselected-${suffix}`,
        expectedRevision: null,
        draftPayload: unselectedDraft,
        now: importedAt,
      }),
      saveActiveWorkImportRow(activeDb(), {
        producerId,
        batchId: batch.batch.id,
        rowOperationKey: `archived-selected-${suffix}`,
        expectedRevision: null,
        draftPayload: selectedDraft,
        now: importedAt,
      }),
    ]);
    const expectedReason = {
      code: "existing_client_archived",
      field: "client.existingClientId",
      message: "Restore this client in Clients & Projects before adding active work.",
    };
    await expect(
      assessStoredActiveWorkImportRow(activeDb(), {
        producerId,
        batchId: batch.batch.id,
        rowId: unselectedRow.row.id,
        asOf: importedAt,
      }),
    ).resolves.toEqual({ state: "needs_info", reasons: [expectedReason] });
    await expect(
      assessStoredActiveWorkImportRow(activeDb(), {
        producerId,
        batchId: batch.batch.id,
        rowId: selectedRow.row.id,
        asOf: importedAt,
      }),
    ).resolves.toEqual({ state: "needs_info", reasons: [expectedReason] });

    const normalized = ready(selectedDraft, importedAt);
    await expect(
      materializeActiveWorkImportRowTransaction(activeDb(), {
        producerId,
        clerkUserId: producerClerkUserId,
        batchId: batch.batch.id,
        rowId: selectedRow.row.id,
        expectedDraftRevision: selectedRow.row.draftRevision,
        expectedDraftDigest: digestCommercialSnapshot(selectedRow.row.draftPayload),
        creationDigest: activeWorkImportCreationDigest(normalized, []),
        normalized,
        proofCapabilities: new Map(),
        agreementPdfCapability: null,
        finalizeAgreementPdf: () => Promise.reject(new Error("no agreement PDF in this fixture")),
        finalizeProof: () =>
          Promise.reject(new Error("proof finalization must not run for an archived Client")),
        importedAt,
      }),
    ).rejects.toMatchObject({
      code: "INVALID_INPUT",
      message: "Restore this client in Clients & Projects before adding active work.",
    });
  });

  it("never turns a missing explicitly selected Client into a new Client", async () => {
    const email = `deleted-selected-${suffix}@example.invalid`;
    const [selectedClient] = await activeDb()
      .insert(clientContacts)
      .values({
        producerId,
        emailHash: emailHashFor(email),
        email,
        name: "Selected before deletion",
      })
      .returning();
    if (!selectedClient) throw new Error("SK-255 selected Client fixture was not saved");
    const batch = await createActiveWorkImportBatch(activeDb(), {
      producerId,
      clerkUserId: producerClerkUserId,
      operationKey: `deleted-selected-batch-${suffix}`,
      now: importedAt,
    });
    const draft = historicalDraft({
      email,
      existingClientId: selectedClient.id,
      title: `Deleted selected Client ${suffix}`,
    });
    const saved = await saveActiveWorkImportRow(activeDb(), {
      producerId,
      batchId: batch.batch.id,
      rowOperationKey: `deleted-selected-row-${suffix}`,
      expectedRevision: null,
      draftPayload: draft,
      now: importedAt,
    });
    const normalized = ready(draft, importedAt);
    await activeDb()
      .delete(clientContacts)
      .where(
        and(eq(clientContacts.id, selectedClient.id), eq(clientContacts.producerId, producerId)),
      );

    await expect(
      materializeActiveWorkImportRowTransaction(activeDb(), {
        producerId,
        clerkUserId: producerClerkUserId,
        batchId: batch.batch.id,
        rowId: saved.row.id,
        expectedDraftRevision: saved.row.draftRevision,
        expectedDraftDigest: digestCommercialSnapshot(saved.row.draftPayload),
        creationDigest: activeWorkImportCreationDigest(normalized, []),
        normalized,
        proofCapabilities: new Map(),
        agreementPdfCapability: null,
        finalizeAgreementPdf: () => Promise.reject(new Error("no agreement PDF in this fixture")),
        finalizeProof: () =>
          Promise.reject(new Error("proof finalization must not run for a missing Client")),
        importedAt,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(
      await activeDb()
        .select({ id: clientContacts.id })
        .from(clientContacts)
        .where(
          and(
            eq(clientContacts.producerId, producerId),
            eq(clientContacts.emailHash, emailHashFor(email)),
          ),
        ),
    ).toHaveLength(0);
  });

  it("resumes the open batch most recently changed by a row save or delete", async () => {
    const older = await createActiveWorkImportBatch(activeDb(), {
      producerId: otherProducerId,
      clerkUserId: otherProducerClerkUserId,
      operationKey: `resume-older-${suffix}`,
      now: new Date("2035-01-01T00:00:00.000Z"),
    });
    const newer = await createActiveWorkImportBatch(activeDb(), {
      producerId: otherProducerId,
      clerkUserId: otherProducerClerkUserId,
      operationKey: `resume-newer-${suffix}`,
      now: new Date("2035-01-02T00:00:00.000Z"),
    });
    const olderRow = await saveActiveWorkImportRow(activeDb(), {
      producerId: otherProducerId,
      batchId: older.batch.id,
      rowOperationKey: `resume-older-row-${suffix}`,
      expectedRevision: null,
      draftPayload: historicalDraft({
        email: `resume-older-${suffix}@example.invalid`,
        title: "Older edited batch",
      }),
      now: new Date("2035-01-03T00:00:00.000Z"),
    });
    expect(
      (await loadLatestOpenActiveWorkImportBatch(activeDb(), { producerId: otherProducerId }))
        ?.batch.id,
    ).toBe(older.batch.id);
    await saveActiveWorkImportRow(activeDb(), {
      producerId: otherProducerId,
      batchId: newer.batch.id,
      rowOperationKey: `resume-newer-row-${suffix}`,
      expectedRevision: null,
      draftPayload: historicalDraft({
        email: `resume-newer-${suffix}@example.invalid`,
        title: "Newer edited batch",
      }),
      now: new Date("2035-01-04T00:00:00.000Z"),
    });
    expect(
      (await loadLatestOpenActiveWorkImportBatch(activeDb(), { producerId: otherProducerId }))
        ?.batch.id,
    ).toBe(newer.batch.id);
    await deleteActiveWorkImportRow(activeDb(), {
      producerId: otherProducerId,
      batchId: older.batch.id,
      rowId: olderRow.row.id,
      now: new Date("2035-01-05T00:00:00.000Z"),
    });
    expect(
      (await loadLatestOpenActiveWorkImportBatch(activeDb(), { producerId: otherProducerId }))
        ?.batch.id,
    ).toBe(older.batch.id);
  });

  it("creates silent imported work once, reuses the normalized client, and reconciles history", async () => {
    const email = `reuse-${suffix}@example.invalid`;
    const [existingClient] = await activeDb()
      .insert(clientContacts)
      .values({
        producerId,
        emailHash: emailHashFor(email),
        email,
        name: "Keep This Artist Name",
        phone: "+1 555 KEEP",
        notes: "Keep this note",
      })
      .returning();
    if (!existingClient) throw new Error("SK-255 existing Client fixture was not saved");

    const batch = await createActiveWorkImportBatch(activeDb(), {
      producerId,
      clerkUserId: producerClerkUserId,
      operationKey: `main-batch-${suffix}`,
      now: importedAt,
    });
    const draft = historicalDraft({
      email: email.toUpperCase(),
      name: "Do Not Overwrite Name",
      phone: "+1 555 REPLACE",
      existingClientId: existingClient.id,
      title: `Silent imported project ${suffix}`,
      payments: [
        {
          operationKey: "historical-partial",
          installmentPosition: 1,
          amountCents: 4_000,
          paidAt: "2035-01-10",
          note: "Producer-confirmed transfer",
        },
        {
          operationKey: "historical-proof-overpayment",
          installmentPosition: 1,
          amountCents: 8_000,
          paidAt: "2035-01-12",
          note: "Producer-confirmed receipt",
          proofUploadToken: "verified-by-workflow-placeholder",
        },
      ],
    });
    const saved = await saveActiveWorkImportRow(activeDb(), {
      producerId,
      batchId: batch.batch.id,
      rowOperationKey: `main-row-${suffix}`,
      expectedRevision: null,
      draftPayload: draft,
      now: importedAt,
    });
    const normalized = ready(draft, importedAt);
    const proofCapability: ActiveWorkImportProofCapability = {
      version: 2,
      kind: "active_work_import_proof",
      uploadId: "a".repeat(64),
      producerId,
      batchId: batch.batch.id,
      rowId: saved.row.id,
      paymentOperationKey: "historical-proof-overpayment",
      originalFileName: "receipt.pdf",
      contentType: "application/pdf",
      sizeBytes: 512,
    };
    const proofShape = [
      {
        paymentOperationKey: proofCapability.paymentOperationKey,
        uploadId: proofCapability.uploadId,
        originalFileName: proofCapability.originalFileName,
        contentType: proofCapability.contentType,
        sizeBytes: proofCapability.sizeBytes,
      },
    ];
    const creationDigest = activeWorkImportCreationDigest(normalized, proofShape);
    let finalizeCalls = 0;
    const materialize = () =>
      materializeActiveWorkImportRowTransaction(activeDb(), {
        producerId,
        clerkUserId: producerClerkUserId,
        batchId: batch.batch.id,
        rowId: saved.row.id,
        expectedDraftRevision: saved.row.draftRevision,
        expectedDraftDigest: digestCommercialSnapshot(saved.row.draftPayload),
        creationDigest,
        normalized,
        proofCapabilities: new Map([[proofCapability.paymentOperationKey, proofCapability]]),
        agreementPdfCapability: null,
        finalizeAgreementPdf: () => Promise.reject(new Error("no agreement PDF in this fixture")),
        finalizeProof: () => {
          finalizeCalls += 1;
          return Promise.resolve({
            storageBucket: "docs",
            storageKey: `proof-evidence/sk255-${suffix}`,
            objectEtag: `etag-${suffix}`,
            contentType: "application/pdf" as const,
            sizeBytes: 512,
          });
        },
        importedAt,
      });
    const first = await materialize();
    const replay = await materialize();
    expect(replay).toMatchObject({
      clientContactId: first.clientContactId,
      projectId: first.projectId,
      purchaseId: first.purchaseId,
      created: false,
    });
    expect(finalizeCalls).toBe(1);

    const [clientAfter] = await activeDb()
      .select()
      .from(clientContacts)
      .where(
        and(eq(clientContacts.id, existingClient.id), eq(clientContacts.producerId, producerId)),
      )
      .limit(1);
    expect(clientAfter).toMatchObject({
      id: existingClient.id,
      name: "Keep This Artist Name",
      phone: "+1 555 KEEP",
      notes: "Keep this note",
      invitedAt: null,
    });
    expect(first.clientContactId).toBe(existingClient.id);

    const [purchase] = await activeDb()
      .select()
      .from(purchases)
      .where(eq(purchases.id, first.purchaseId))
      .limit(1);
    expect(purchase).toMatchObject({
      sourceKind: "imported_existing_work",
      acceptedAt: null,
      commercialEstablishedAt: importedAt,
      lifecycleStatus: "active",
      activatedAt: importedAt,
    });
    const [installments, attestations, tracks, proofs, payments, projectNotifications] =
      await Promise.all([
        activeDb()
          .select()
          .from(purchaseInstallments)
          .where(eq(purchaseInstallments.purchaseId, first.purchaseId)),
        activeDb()
          .select()
          .from(purchaseImportAttestations)
          .where(eq(purchaseImportAttestations.purchaseId, first.purchaseId)),
        activeDb().select().from(projectTracks).where(eq(projectTracks.projectId, first.projectId)),
        activeDb()
          .select()
          .from(paymentProofs)
          .where(eq(paymentProofs.purchaseId, first.purchaseId)),
        activeDb()
          .select()
          .from(purchasePayments)
          .where(eq(purchasePayments.purchaseId, first.purchaseId)),
        activeDb().select().from(notifications).where(eq(notifications.projectId, first.projectId)),
      ]);
    // A successful attestation proves the full schedule existed first: the
    // foundation trigger seals the schedule at attestation insertion.
    expect(installments).toHaveLength(1);
    expect(installments[0]).toMatchObject({
      dueTrigger: "producer_import",
      remindersEnabled: false,
      status: "confirmed",
    });
    expect(attestations).toHaveLength(1);
    expect(tracks).toHaveLength(0);
    expect(projectNotifications).toHaveLength(0);
    expect(proofs).toHaveLength(1);
    expect(proofs[0]).toMatchObject({
      status: "confirmed",
      note: "Producer-confirmed receipt",
      confirmedAt: importedAt,
    });
    expect(payments).toHaveLength(2);
    expect(payments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          operationKey: "historical-proof-overpayment",
          source: "proof",
          addedByClerkUserId: producerClerkUserId,
          paidAt: new Date("2035-01-12T00:00:00.000Z"),
        }),
      ]),
    );
    const ledger = await readPurchaseLedger(purchaseLedgerRepository(activeDb()), {
      producerId,
      purchaseId: first.purchaseId,
      asOf: importedAt,
    });
    expect(ledger.projection).toMatchObject({
      paidCents: 12_000,
      remainingCents: 0,
      overpaidCents: 2_000,
      activationSatisfied: true,
      fullyPaidForDownloads: true,
    });

    await expect(
      materializeActiveWorkImportRowTransaction(activeDb(), {
        producerId: otherProducerId,
        clerkUserId: `sk255-other-${suffix}`,
        batchId: batch.batch.id,
        rowId: saved.row.id,
        expectedDraftRevision: saved.row.draftRevision,
        expectedDraftDigest: "does-not-matter-outside-scope",
        creationDigest,
        normalized,
        proofCapabilities: new Map(),
        agreementPdfCapability: null,
        finalizeAgreementPdf: () => Promise.reject(new Error("no agreement PDF in this fixture")),
        finalizeProof: () => Promise.reject(new Error("must not finalize outside scope")),
        importedAt,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("rolls back one failed row without erasing another row or either draft", async () => {
    const batch = await createActiveWorkImportBatch(activeDb(), {
      producerId,
      clerkUserId: producerClerkUserId,
      operationKey: `partial-batch-${suffix}`,
      now: importedAt,
    });
    const failedDraft = historicalDraft({
      email: `failed-${suffix}@example.invalid`,
      title: `Rolled back project ${suffix}`,
      payments: [
        {
          operationKey: "proof-that-fails",
          installmentPosition: 1,
          amountCents: 10_000,
          paidAt: "2035-01-10",
          proofUploadToken: "verified-by-workflow-placeholder",
        },
      ],
    });
    const goodDraft = historicalDraft({
      email: `created-${suffix}@example.invalid`,
      name: "New Silent Client",
      phone: "+972 50 123 4567",
      title: `Created project ${suffix}`,
    });
    const [failedRow, goodRow] = await Promise.all([
      saveActiveWorkImportRow(activeDb(), {
        producerId,
        batchId: batch.batch.id,
        rowOperationKey: `failed-row-${suffix}`,
        expectedRevision: null,
        draftPayload: failedDraft,
        now: importedAt,
      }),
      saveActiveWorkImportRow(activeDb(), {
        producerId,
        batchId: batch.batch.id,
        rowOperationKey: `good-row-${suffix}`,
        expectedRevision: null,
        draftPayload: goodDraft,
        now: importedAt,
      }),
    ]);
    const failedNormalized = ready(failedDraft, importedAt);
    const goodNormalized = ready(goodDraft, importedAt);
    const failedCapability: ActiveWorkImportProofCapability = {
      version: 2,
      kind: "active_work_import_proof",
      uploadId: "b".repeat(64),
      producerId,
      batchId: batch.batch.id,
      rowId: failedRow.row.id,
      paymentOperationKey: "proof-that-fails",
      originalFileName: "failed.pdf",
      contentType: "application/pdf",
      sizeBytes: 512,
    };
    await expect(
      materializeActiveWorkImportRowTransaction(activeDb(), {
        producerId,
        clerkUserId: producerClerkUserId,
        batchId: batch.batch.id,
        rowId: failedRow.row.id,
        expectedDraftRevision: failedRow.row.draftRevision,
        expectedDraftDigest: digestCommercialSnapshot(failedRow.row.draftPayload),
        creationDigest: activeWorkImportCreationDigest(failedNormalized, [
          {
            paymentOperationKey: failedCapability.paymentOperationKey,
            uploadId: failedCapability.uploadId,
            originalFileName: failedCapability.originalFileName,
            contentType: failedCapability.contentType,
            sizeBytes: failedCapability.sizeBytes,
          },
        ]),
        normalized: failedNormalized,
        proofCapabilities: new Map([[failedCapability.paymentOperationKey, failedCapability]]),
        agreementPdfCapability: null,
        finalizeAgreementPdf: () => Promise.reject(new Error("no agreement PDF in this fixture")),
        finalizeProof: () => Promise.reject(new Error("synthetic proof finalization failure")),
        importedAt,
      }),
    ).rejects.toThrow("synthetic proof finalization failure");

    const goodDigest = activeWorkImportCreationDigest(goodNormalized, []);
    const good = await materializeActiveWorkImportRowTransaction(activeDb(), {
      producerId,
      clerkUserId: producerClerkUserId,
      batchId: batch.batch.id,
      rowId: goodRow.row.id,
      expectedDraftRevision: goodRow.row.draftRevision,
      expectedDraftDigest: digestCommercialSnapshot(goodRow.row.draftPayload),
      creationDigest: goodDigest,
      normalized: goodNormalized,
      proofCapabilities: new Map(),
      agreementPdfCapability: null,
      finalizeAgreementPdf: () => Promise.reject(new Error("no agreement PDF in this fixture")),
      finalizeProof: () =>
        Promise.reject(new Error("proof finalization must not run for a proofless row")),
      importedAt,
    });
    const rowsAfter = await activeDb()
      .select()
      .from(activeWorkImportRows)
      .where(
        and(
          eq(activeWorkImportRows.batchId, batch.batch.id),
          eq(activeWorkImportRows.producerId, producerId),
        ),
      );
    expect(rowsAfter.find((row) => row.id === failedRow.row.id)).toMatchObject({
      materializedAt: null,
      createdClientContactId: null,
      createdProjectId: null,
      createdPurchaseId: null,
      draftPayload: failedDraft,
    });
    expect(rowsAfter.find((row) => row.id === goodRow.row.id)).toMatchObject({
      materializedAt: importedAt,
      createdClientContactId: good.clientContactId,
      createdProjectId: good.projectId,
      createdPurchaseId: good.purchaseId,
      draftPayload: goodDraft,
    });
    const [rolledBackProjects, goodClient, goodTracks] = await Promise.all([
      activeDb()
        .select({ id: projects.id })
        .from(projects)
        .where(eq(projects.title, `Rolled back project ${suffix}`)),
      activeDb()
        .select()
        .from(clientContacts)
        .where(eq(clientContacts.id, good.clientContactId))
        .limit(1),
      activeDb().select().from(projectTracks).where(eq(projectTracks.projectId, good.projectId)),
    ]);
    expect(rolledBackProjects).toHaveLength(0);
    expect(goodClient[0]).toMatchObject({
      name: "New Silent Client",
      phone: "+972 50 123 4567",
      invitedAt: null,
    });
    expect(goodTracks).toHaveLength(0);
  });

  it("serializes failed-proof cleanup ahead of a concurrent row retry", async () => {
    const batch = await createActiveWorkImportBatch(activeDb(), {
      producerId,
      clerkUserId: producerClerkUserId,
      operationKey: `cleanup-race-batch-${suffix}`,
      now: importedAt,
    });
    const draft = historicalDraft({
      email: `cleanup-race-${suffix}@example.invalid`,
      title: `Cleanup race ${suffix}`,
      payments: [
        {
          operationKey: "cleanup-race-proof",
          installmentPosition: 1,
          amountCents: 10_000,
          paidAt: "2035-01-10",
          proofUploadToken: "verified-by-workflow-placeholder",
        },
      ],
    });
    const saved = await saveActiveWorkImportRow(activeDb(), {
      producerId,
      batchId: batch.batch.id,
      rowOperationKey: `cleanup-race-row-${suffix}`,
      expectedRevision: null,
      draftPayload: draft,
      now: importedAt,
    });
    const normalized = ready(draft, importedAt);
    const capability: ActiveWorkImportProofCapability = {
      version: 2,
      kind: "active_work_import_proof",
      uploadId: "c".repeat(64),
      producerId,
      batchId: batch.batch.id,
      rowId: saved.row.id,
      paymentOperationKey: "cleanup-race-proof",
      originalFileName: "cleanup-race.pdf",
      contentType: "application/pdf",
      sizeBytes: 512,
    };
    const storageKey = `proof-evidence/cleanup-race-${suffix}`;
    let announceDelete: () => void = () => undefined;
    const deleteStarted = new Promise<void>((resolve) => {
      announceDelete = resolve;
    });
    let releaseDelete: () => void = () => undefined;
    const deleteRelease = new Promise<void>((resolve) => {
      releaseDelete = resolve;
    });
    const cleanup = cleanupUnpersistedActiveWorkImportProof(activeDb(), {
      producerId,
      batchId: batch.batch.id,
      rowId: saved.row.id,
      storageKey,
      deleteProof: async () => {
        announceDelete();
        await deleteRelease;
      },
    });
    await deleteStarted;

    let retryFinalizationStarted = false;
    const retry = materializeActiveWorkImportRowTransaction(activeDb(), {
      producerId,
      clerkUserId: producerClerkUserId,
      batchId: batch.batch.id,
      rowId: saved.row.id,
      expectedDraftRevision: saved.row.draftRevision,
      expectedDraftDigest: digestCommercialSnapshot(saved.row.draftPayload),
      creationDigest: activeWorkImportCreationDigest(normalized, [
        {
          paymentOperationKey: capability.paymentOperationKey,
          uploadId: capability.uploadId,
          originalFileName: capability.originalFileName,
          contentType: capability.contentType,
          sizeBytes: capability.sizeBytes,
        },
      ]),
      normalized,
      proofCapabilities: new Map([[capability.paymentOperationKey, capability]]),
      agreementPdfCapability: null,
      finalizeAgreementPdf: () => Promise.reject(new Error("no agreement PDF in this fixture")),
      finalizeProof: () => {
        retryFinalizationStarted = true;
        return Promise.resolve({
          storageBucket: "docs",
          storageKey,
          objectEtag: `cleanup-race-etag-${suffix}`,
          contentType: "application/pdf" as const,
          sizeBytes: 512,
        });
      },
      importedAt,
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(retryFinalizationStarted).toBe(false);

    releaseDelete();
    await expect(cleanup).resolves.toBe("deleted");
    const result = await retry;
    expect(retryFinalizationStarted).toBe(true);
    expect(
      await activeDb()
        .select({ id: paymentProofs.id })
        .from(paymentProofs)
        .where(
          and(eq(paymentProofs.producerId, producerId), eq(paymentProofs.storageKey, storageKey)),
        ),
    ).toHaveLength(1);
    expect(result.created).toBe(true);
  });
});
