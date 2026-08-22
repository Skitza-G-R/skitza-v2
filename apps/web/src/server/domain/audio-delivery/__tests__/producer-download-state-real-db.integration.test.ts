import { randomUUID } from "node:crypto";

import { createDb, sql, type Db } from "@skitza/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { audioDeliveryRepository, producerDownloadStateRepository } from "../db";
import {
  readArtistDownloadEntitlement,
  readDownloadOverrideState,
  readDownloadOverrideStates,
} from "../service";

// This suite never falls back to DATABASE_URL. DATABASE_URL_TEST is the
// repository's explicit opt-in for a separate disposable CI/test database.
const testDatabaseUrl = process.env.DATABASE_URL_TEST?.trim();
if (process.env.CI === "true" && !testDatabaseUrl) {
  throw new Error("SK-144 real database integration requires DATABASE_URL_TEST in CI");
}
const describeWithTestDatabase = testDatabaseUrl ? describe : describe.skip;
const testSchema = `sk144_${randomUUID().replaceAll("-", "")}`;

type TestTable =
  | "producers"
  | "client_contacts"
  | "projects"
  | "purchases"
  | "project_tracks"
  | "track_versions"
  | "purchase_installments"
  | "payment_proofs"
  | "purchase_payments"
  | "purchase_payment_corrections"
  | "purchase_waivers"
  | "purchase_cancellations"
  | "project_payment_pause_events"
  | "purchase_download_override_events";

function assertValidTestSchema(): void {
  if (!/^sk144_[a-f0-9]{32}$/.test(testSchema)) {
    throw new Error("SK-144 generated test schema is invalid");
  }
}

function qualifiedTestTable(table: TestTable): string {
  assertValidTestSchema();
  return `"${testSchema}"."${table}"`;
}

type TransactionFn = Db["transaction"];

function withIsolatedTransactionSchema(database: Db): Db {
  const runTransaction = database.transaction.bind(database);
  database.transaction = (async (...args: Parameters<TransactionFn>) => {
    const [work, config] = args;
    return runTransaction(async (transaction) => {
      assertValidTestSchema();
      await transaction.execute(sql.raw(`set local search_path to "${testSchema}"`));
      return work(transaction);
    }, config);
  }) as TransactionFn;
  return database;
}

describeWithTestDatabase("SK-144 producer download-state batch — disposable test database", () => {
  const adminDb = testDatabaseUrl ? createDb(testDatabaseUrl) : null;
  const transactionDb = testDatabaseUrl
    ? withIsolatedTransactionSchema(createDb(testDatabaseUrl))
    : null;
  let schemaCreated = false;

  const producerId = randomUUID();
  const producerClerkUserId = `sk144-producer-${randomUUID()}`;
  const foreignProducerId = randomUUID();
  const foreignProducerClerkUserId = `sk144-foreign-${randomUUID()}`;
  const clientContactId = randomUUID();
  const artistClerkUserId = `sk144-artist-${randomUUID()}`;
  const projectId = randomUUID();
  const purchaseId = randomUUID();
  const trackId = randomUUID();
  const liveVersionId = randomUUID();
  const deletedVersionId = randomUUID();
  const plainVersionId = randomUUID();
  const installmentId = randomUUID();
  const paymentId = randomUUID();

  function activeAdminDb(): Db {
    if (!adminDb) throw new Error("SK-144 test database administrator is unavailable");
    return adminDb;
  }

  function activeTransactionDb(): Db {
    if (!transactionDb) throw new Error("SK-144 transaction database is unavailable");
    return transactionDb;
  }

  async function dropTestSchema(): Promise<void> {
    if (!schemaCreated) return;
    assertValidTestSchema();
    await activeAdminDb().execute(sql.raw(`drop schema "${testSchema}" cascade`));
    schemaCreated = false;
  }

  beforeAll(async () => {
    assertValidTestSchema();
    const schema = `"${testSchema}"`;
    await activeAdminDb().execute(sql.raw(`create schema ${schema}`));
    schemaCreated = true;

    try {
      const statements = [
        `create table ${schema}."producers" (
          "id" uuid primary key,
          "clerk_user_id" text not null unique,
          "display_name" text,
          "timezone" text not null default 'UTC',
          "autopilot_unpaid_reminder" boolean not null default true
        )`,
        `create table ${schema}."client_contacts" (
          "id" uuid primary key,
          "producer_id" uuid not null,
          "clerk_user_id" text,
          "archived_at" timestamptz,
          "name" text not null,
          "email" text not null
        )`,
        `create table ${schema}."projects" (
          "id" uuid primary key,
          "producer_id" uuid not null,
          "client_contact_id" uuid not null,
          "lifecycle_status" text not null
        )`,
        `create table ${schema}."purchases" (
          "id" uuid primary key,
          "producer_id" uuid not null,
          "project_id" uuid not null,
          "client_contact_id" uuid not null,
          "source_kind" text not null default 'store_product',
          "currency" text not null,
          "total_cents" integer not null,
          "payment_plan_kind" text,
          "lifecycle_status" text not null,
          "accepted_at" timestamptz,
          "commercial_established_at" timestamptz not null,
          "activated_at" timestamptz,
          "canceled_at" timestamptz,
          "ref_number" text not null,
          "commercial_snapshot" jsonb not null,
          constraint "purchases_commercial_establishment_shape" check ((
            ("source_kind" = 'imported_existing_work' and "accepted_at" is null)
            or ("source_kind" <> 'imported_existing_work'
              and "accepted_at" = "commercial_established_at")
          ) is true)
        )`,
        // Mirrors migration 0055: accepted Purchases inserted without an explicit
        // establishment time are established at Artist acceptance.
        `create function ${schema}."default_purchase_commercial_established_at"()
        returns trigger as $function$
        begin
          new."commercial_established_at" :=
            coalesce(new."commercial_established_at", new."accepted_at");
          return new;
        end;
        $function$ language plpgsql`,
        `create trigger "purchases_default_commercial_established_at"
          before insert on ${schema}."purchases"
          for each row execute function ${schema}."default_purchase_commercial_established_at"()`,
        `create table ${schema}."project_tracks" (
          "id" uuid primary key,
          "project_id" uuid not null,
          "purchase_id" uuid not null,
          "title" text not null
        )`,
        `create table ${schema}."track_versions" (
          "id" uuid primary key,
          "track_id" uuid not null,
          "purchase_id" uuid not null,
          "producer_id" uuid not null,
          "label" text not null,
          "audio_url" text,
          "audio_r2_key" text,
          "size_bytes" bigint,
          "audio_object_etag" text,
          "audio_identity_fingerprint" text,
          "audio_deleted_at" timestamptz,
          "pending_audio_r2_key" text,
          "pending_audio_upload_id" text,
          "pending_audio_initiation_digest" text,
          "pending_audio_completion_token" text,
          "pending_audio_size_bytes" bigint,
          "pending_audio_started_at" timestamptz,
          "pending_audio_create_attempted_at" timestamptz,
          "pending_audio_complete_attempted_at" timestamptz,
          "pending_audio_part_urls_expire_at" timestamptz,
          "pending_audio_cancel_requested_at" timestamptz,
          "pending_audio_cleanup_etag" text
        )`,
        `create table ${schema}."purchase_installments" (
          "id" uuid primary key,
          "purchase_id" uuid not null,
          "producer_id" uuid not null,
          "position" integer not null,
          "amount_cents" integer not null,
          "currency" text not null,
          "due_trigger" text not null,
          "due_at" timestamptz,
          "triggered_at" timestamptz,
          "required_for_activation" boolean not null,
          "status" text not null,
          "reminders_enabled" boolean not null,
          "created_at" timestamptz not null default now(),
          "updated_at" timestamptz not null
        )`,
        `create table ${schema}."payment_proofs" (
          "purchase_id" uuid not null,
          "installment_id" uuid not null,
          "producer_id" uuid not null,
          "status" text not null
        )`,
        `create table ${schema}."purchase_payments" (
          "id" uuid primary key,
          "purchase_id" uuid not null,
          "installment_id" uuid not null,
          "producer_id" uuid not null,
          "proof_id" uuid,
          "operation_key" text not null,
          "operation_digest" text not null,
          "source" text not null,
          "amount_cents" integer not null,
          "currency" text not null,
          "paid_at" timestamptz not null,
          "added_by_clerk_user_id" text not null,
          "note" text,
          "created_at" timestamptz not null default now()
        )`,
        `create table ${schema}."purchase_payment_corrections" (
          "id" uuid primary key,
          "purchase_id" uuid not null,
          "payment_id" uuid not null,
          "producer_id" uuid not null,
          "operation_key" text not null,
          "operation_digest" text not null,
          "sequence" integer not null,
          "previous_amount_cents" integer not null,
          "new_amount_cents" integer not null,
          "reason" text not null,
          "corrected_by_clerk_user_id" text not null,
          "created_at" timestamptz not null default now()
        )`,
        `create table ${schema}."purchase_waivers" (
          "id" uuid primary key,
          "purchase_id" uuid not null,
          "installment_id" uuid not null,
          "producer_id" uuid not null,
          "operation_key" text not null,
          "operation_digest" text not null,
          "amount_cents" integer not null,
          "reason" text not null,
          "waived_by_clerk_user_id" text not null,
          "created_at" timestamptz not null default now()
        )`,
        `create table ${schema}."purchase_cancellations" (
          "id" uuid primary key,
          "purchase_id" uuid not null,
          "producer_id" uuid not null,
          "operation_key" text not null,
          "operation_digest" text not null,
          "reason" text not null,
          "canceled_by_clerk_user_id" text not null,
          "canceled_at" timestamptz not null,
          "created_at" timestamptz not null default now()
        )`,
        `create table ${schema}."project_payment_pause_events" (
          "id" uuid primary key,
          "purchase_id" uuid not null,
          "project_id" uuid not null,
          "producer_id" uuid not null,
          "action" text not null,
          "operation_key" text not null,
          "operation_digest" text not null,
          "reason" text not null,
          "changed_by_clerk_user_id" text not null,
          "changed_at" timestamptz not null,
          "created_at" timestamptz not null default now()
        )`,
        `create table ${schema}."purchase_download_override_events" (
          "id" uuid primary key,
          "purchase_id" uuid not null,
          "version_id" uuid not null,
          "producer_id" uuid not null,
          "enabled" boolean not null,
          "sequence" integer not null
        )`,
      ];
      for (const statement of statements) {
        await activeAdminDb().execute(sql.raw(statement));
      }

      const acceptedAt = new Date("2020-07-01T08:00:00.000Z");
      const deletedAt = new Date("2020-07-02T08:00:00.000Z");
      const commercialSnapshot = JSON.stringify({
        productOrOfferName: "SK-144 real database fixture",
      });

      await activeAdminDb().execute(sql`
        insert into ${sql.raw(qualifiedTestTable("producers"))}
          ("id", "clerk_user_id", "display_name", "timezone")
        values
          (${producerId}, ${producerClerkUserId}, ${"Fixture producer"}, ${"UTC"}),
          (${foreignProducerId}, ${foreignProducerClerkUserId}, ${"Foreign producer"}, ${"UTC"})
      `);
      await activeAdminDb().execute(sql`
        insert into ${sql.raw(qualifiedTestTable("client_contacts"))}
          ("id", "producer_id", "clerk_user_id", "name", "email")
        values (${clientContactId}, ${producerId}, ${artistClerkUserId},
          ${"Fixture artist"}, ${"artist-sk144@example.test"})
      `);
      await activeAdminDb().execute(sql`
        insert into ${sql.raw(qualifiedTestTable("projects"))}
          ("id", "producer_id", "client_contact_id", "lifecycle_status")
        values (${projectId}, ${producerId}, ${clientContactId}, ${"active"})
      `);
      await activeAdminDb().execute(sql`
        insert into ${sql.raw(qualifiedTestTable("purchases"))}
          ("id", "producer_id", "project_id", "client_contact_id", "currency",
           "total_cents", "payment_plan_kind", "lifecycle_status", "accepted_at",
           "activated_at", "ref_number", "commercial_snapshot")
        values (${purchaseId}, ${producerId}, ${projectId}, ${clientContactId}, ${"ILS"},
          ${10_000}, ${"full"}, ${"active"}, ${acceptedAt}, ${acceptedAt},
          ${`SK144-${purchaseId}`}, ${commercialSnapshot}::jsonb)
      `);
      await activeAdminDb().execute(sql`
        insert into ${sql.raw(qualifiedTestTable("project_tracks"))}
          ("id", "project_id", "purchase_id", "title")
        values (${trackId}, ${projectId}, ${purchaseId}, ${"SK-144 exact song"})
      `);
      await activeAdminDb().execute(sql`
        insert into ${sql.raw(qualifiedTestTable("track_versions"))}
          ("id", "track_id", "purchase_id", "producer_id", "label", "audio_url",
           "audio_r2_key", "size_bytes", "audio_object_etag",
           "audio_identity_fingerprint", "audio_deleted_at")
        values
          (${liveVersionId}, ${trackId}, ${purchaseId}, ${producerId}, ${"V2"},
           ${`/api/audio/stream/${liveVersionId}`}, ${`versions/${liveVersionId}/audio`},
           ${2048}, ${"etag-live"}, ${"fingerprint-live"}, ${null}),
          (${deletedVersionId}, ${trackId}, ${purchaseId}, ${producerId}, ${"V1"},
           ${`/api/audio/stream/${deletedVersionId}`},
           ${`versions/${deletedVersionId}/audio`}, ${1536}, ${"etag-deleted"},
           ${"fingerprint-deleted"}, ${deletedAt}),
          (${plainVersionId}, ${trackId}, ${purchaseId}, ${producerId}, ${"V0"},
           ${`/api/audio/stream/${plainVersionId}`}, ${`versions/${plainVersionId}/audio`},
           ${1024}, ${"etag-plain"}, ${"fingerprint-plain"}, ${null})
      `);
      await activeAdminDb().execute(sql`
        insert into ${sql.raw(qualifiedTestTable("purchase_installments"))}
          ("id", "purchase_id", "producer_id", "position", "amount_cents", "currency",
           "due_trigger", "due_at", "required_for_activation", "status",
           "reminders_enabled", "updated_at")
        values (${installmentId}, ${purchaseId}, ${producerId}, ${1}, ${10_000}, ${"ILS"},
          ${"acceptance"}, ${new Date("2020-07-15T08:00:00.000Z")}, ${true},
          ${"overdue"}, ${true}, ${acceptedAt})
      `);
      await activeAdminDb().execute(sql`
        insert into ${sql.raw(qualifiedTestTable("purchase_payments"))}
          ("id", "purchase_id", "installment_id", "producer_id", "operation_key",
           "operation_digest", "source", "amount_cents", "currency", "paid_at",
           "added_by_clerk_user_id")
        values (${paymentId}, ${purchaseId}, ${installmentId}, ${producerId},
          ${`sk144-payment-${paymentId}`}, ${`sk144-payment-digest-${paymentId}`},
          ${"manual"}, ${3000}, ${"ILS"}, ${acceptedAt}, ${producerClerkUserId})
      `);
      await activeAdminDb().execute(sql`
        insert into ${sql.raw(qualifiedTestTable("purchase_download_override_events"))}
          ("id", "purchase_id", "version_id", "producer_id", "enabled", "sequence")
        values
          (${randomUUID()}, ${purchaseId}, ${liveVersionId}, ${producerId}, ${true}, ${1}),
          (${randomUUID()}, ${purchaseId}, ${liveVersionId}, ${producerId}, ${false}, ${2}),
          (${randomUUID()}, ${purchaseId}, ${deletedVersionId}, ${producerId}, ${false}, ${1}),
          (${randomUUID()}, ${purchaseId}, ${deletedVersionId}, ${producerId}, ${false}, ${2}),
          (${randomUUID()}, ${purchaseId}, ${deletedVersionId}, ${producerId}, ${true}, ${3})
      `);
    } catch (error) {
      await dropTestSchema();
      throw error;
    }
  }, 30_000);

  afterAll(async () => {
    await dropTestSchema();
  }, 30_000);

  it("matches exact single-version states in requested order, including deleted audio and latest overrides", async () => {
    const repository = audioDeliveryRepository(activeTransactionDb());
    const input = {
      producerId,
      actorClerkUserId: producerClerkUserId,
      purchaseId,
    };
    const batch = await readDownloadOverrideStates(
      producerDownloadStateRepository(activeTransactionDb()),
      {
        ...input,
        trackId,
        versionIds: [deletedVersionId, plainVersionId, liveVersionId],
      },
    );
    const deletedSingle = await readDownloadOverrideState(repository, {
      ...input,
      versionId: deletedVersionId,
    });
    const liveSingle = await readDownloadOverrideState(repository, {
      ...input,
      versionId: liveVersionId,
    });
    const plainSingle = await readDownloadOverrideState(repository, {
      ...input,
      versionId: plainVersionId,
    });

    expect(batch).toEqual([deletedSingle, plainSingle, liveSingle]);
    expect(batch).toEqual([
      {
        purchaseId,
        versionId: deletedVersionId,
        enabled: true,
        fullyPaid: false,
        unpaidAmountCents: 7000,
        currency: "ILS",
        overdue: true,
        sequence: 3,
      },
      {
        purchaseId,
        versionId: plainVersionId,
        enabled: false,
        fullyPaid: false,
        unpaidAmountCents: 7000,
        currency: "ILS",
        overdue: true,
        sequence: 0,
      },
      {
        purchaseId,
        versionId: liveVersionId,
        enabled: false,
        fullyPaid: false,
        unpaidAmountCents: 7000,
        currency: "ILS",
        overdue: true,
        sequence: 2,
      },
    ]);
    await expect(
      readArtistDownloadEntitlement(repository, {
        artistClerkUserId,
        purchaseId,
        versionId: deletedVersionId,
      }),
    ).resolves.toMatchObject({
      purchaseId,
      versionId: deletedVersionId,
      canDownload: false,
      permission: "audio_deleted",
      sequence: 3,
    });
  }, 30_000);

  it("rejects foreign-producer and missing-version batches in the real repository", async () => {
    const repository = producerDownloadStateRepository(activeTransactionDb());

    await expect(
      readDownloadOverrideStates(repository, {
        producerId: foreignProducerId,
        actorClerkUserId: foreignProducerClerkUserId,
        purchaseId,
        trackId,
        versionIds: [liveVersionId, deletedVersionId, plainVersionId],
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    await expect(
      readDownloadOverrideStates(repository, {
        producerId,
        actorClerkUserId: foreignProducerClerkUserId,
        purchaseId,
        trackId,
        versionIds: [liveVersionId, deletedVersionId, plainVersionId],
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    await expect(
      readDownloadOverrideStates(repository, {
        producerId,
        actorClerkUserId: producerClerkUserId,
        purchaseId,
        trackId,
        versionIds: [liveVersionId, randomUUID()],
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  }, 30_000);
});
