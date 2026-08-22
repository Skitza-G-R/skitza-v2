import { readFileSync } from "node:fs";
import { join } from "node:path";

import { getTableConfig, type PgTable } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import * as schema from "../schema";

const migration = readFileSync(
  join(process.cwd(), "drizzle/0054_active_work_import_foundation.sql"),
  "utf8",
);
const purchaseFoundationMigration = readFileSync(
  join(process.cwd(), "drizzle/0027_purchase_foundation.sql"),
  "utf8",
);
const executableMigration = migration.replace(/^\s*--.*$/gm, "");

function foreignKeys(table: PgTable): string[] {
  return getTableConfig(table).foreignKeys.map((key) => key.getName());
}

function uniqueConstraints(table: PgTable): string[] {
  return getTableConfig(table)
    .uniqueConstraints.map((constraint) => constraint.name)
    .filter((name): name is string => name !== undefined);
}

function indexes(table: PgTable): string[] {
  return getTableConfig(table)
    .indexes.map((item) => item.config.name)
    .filter((name): name is string => name !== undefined);
}

function checks(table: PgTable): string[] {
  return getTableConfig(table).checks.map((constraint) => constraint.name);
}

describe("SK-255 active-work import database foundation", () => {
  it("rebuilds both extended enums inside one atomic migration", () => {
    expect(schema.purchaseSourceKind.enumValues).toEqual([
      "store_product",
      "private_offer",
      "session_product",
      "paid_add_on",
      "no_charge_add_on",
      "imported_existing_work",
    ]);
    expect(schema.purchaseInstallmentDueTrigger.enumValues).toEqual([
      "acceptance",
      "producer_import",
      "monthly_anniversary",
      "artist_approval",
    ]);

    expect(migration).toContain('RENAME TO "purchase_source_kind_legacy"');
    expect(migration).toContain('RENAME TO "purchase_installment_due_trigger_legacy"');
    expect(migration).toContain('USING "source_kind"::text::"purchase_source_kind"');
    expect(migration).toContain('USING "due_trigger"::text::"purchase_installment_due_trigger"');
    expect(executableMigration).not.toMatch(/ALTER TYPE[\s\S]{0,120}ADD VALUE/);
  });

  it("keeps Artist acceptance truthful and gives imports immutable Producer attestation", () => {
    expect(schema.purchases.acceptedAt.notNull).toBe(false);
    expect(schema.purchases.commercialEstablishedAt.notNull).toBe(true);
    expect(schema.purchaseImportAttestations.importedByClerkUserId.notNull).toBe(true);
    expect(schema.purchaseImportAttestations.importedSnapshot.notNull).toBe(true);
    expect(schema.purchaseImportAttestations.importedAt.notNull).toBe(true);

    expect(uniqueConstraints(schema.purchaseImportAttestations)).toContain(
      "purchase_import_attestations_purchase_unique",
    );
    expect(foreignKeys(schema.purchaseImportAttestations)).toEqual(
      expect.arrayContaining([
        "purchase_import_attestations_purchase_owner_fk",
        "purchase_import_attestations_purchase_snapshot_fk",
        "purchase_import_attestations_established_at_fk",
        "purchase_import_attestations_importing_producer_fk",
      ]),
    );
    expect(checks(schema.purchases)).toContain("purchases_commercial_establishment_shape");
    expect(checks(schema.purchaseImportAttestations)).not.toContain(
      "purchase_import_attestations_timestamp_shape",
    );

    expect(migration).toMatch(
      /source_kind"::text = 'imported_existing_work'[\s\S]*"accepted_at" IS NULL/,
    );
    expect(migration).toMatch(
      /source_kind"::text <> 'imported_existing_work'[\s\S]*"accepted_at" = "commercial_established_at"/,
    );
    expect(migration).toContain("SKITZA_IMPORTED_PURCHASE_REQUIRES_PRODUCER_ATTESTATION_ONLY");
    expect(migration).toContain("SKITZA_ACCEPTED_PURCHASE_REQUIRES_ARTIST_ACCEPTANCE_ONLY");
    expect(migration).toContain('CREATE TRIGGER "purchase_import_attestations_append_only"');
    expect(migration).not.toContain("purchase_import_attestations_timestamp_shape");
    expect(migration).toMatch(
      /CREATE CONSTRAINT TRIGGER "purchases_validate_commercial_establishment"[\s\S]*AFTER INSERT OR UPDATE OR DELETE[\s\S]*DEFERRABLE INITIALLY DEFERRED/,
    );
    expect(migration).toMatch(
      /CREATE CONSTRAINT TRIGGER "purchase_acceptances_validate_establishment"[\s\S]*AFTER INSERT OR UPDATE OR DELETE[\s\S]*DEFERRABLE INITIALLY DEFERRED/,
    );
    expect(migration).toMatch(
      /CREATE CONSTRAINT TRIGGER "purchase_import_attestations_validate_establishment"[\s\S]*AFTER INSERT OR UPDATE OR DELETE[\s\S]*DEFERRABLE INITIALLY DEFERRED/,
    );
    expect(migration).not.toMatch(/INSERT\s+INTO\s+"purchase_acceptances"/i);
  });

  it("backfills canceled Purchases without leaving their immutable-snapshot guard disabled", () => {
    const snapshotDisableAt = migration.indexOf(
      'DISABLE TRIGGER "purchases_protect_commercial_snapshot"',
    );
    const scheduleDisableAt = migration.indexOf(
      'DISABLE TRIGGER "purchases_validate_installment_schedule"',
    );
    const backfillAt = migration.indexOf(
      'SET "commercial_established_at" = "accepted_at"',
    );
    const snapshotEnableAt = migration.indexOf(
      'ENABLE TRIGGER "purchases_protect_commercial_snapshot"',
    );
    const scheduleEnableAt = migration.indexOf(
      'ENABLE TRIGGER "purchases_validate_installment_schedule"',
    );

    expect(snapshotDisableAt).toBeGreaterThan(-1);
    expect(scheduleDisableAt).toBeGreaterThan(snapshotDisableAt);
    expect(backfillAt).toBeGreaterThan(scheduleDisableAt);
    expect(snapshotEnableAt).toBeGreaterThan(backfillAt);
    expect(scheduleEnableAt).toBeGreaterThan(snapshotEnableAt);
    expect(migration.match(/DISABLE TRIGGER/g)).toHaveLength(2);
    expect(migration.match(/ENABLE TRIGGER/g)).toHaveLength(2);
  });

  it("makes imported source ownership and source shape unambiguous", () => {
    expect(foreignKeys(schema.activeWorkImportRows)).toEqual(
      expect.arrayContaining([
        "active_work_import_rows_batch_producer_fk",
        "active_work_import_rows_client_producer_fk",
        "active_work_import_rows_project_owner_fk",
        "active_work_import_rows_purchase_owner_fk",
      ]),
    );
    expect(migration).toMatch(
      /source_kind"::text = 'imported_existing_work'[\s\S]*"product_id" IS NULL[\s\S]*"private_offer_id" IS NULL[\s\S]*"purchase_request_id" IS NULL/,
    );
    expect(migration).toContain("SKITZA_IMPORTED_PURCHASE_SOURCE_MUST_BE_EMPTY");
    expect(migration).toMatch(/'imported_existing_work'[\s\S]*\)[\s\S]*AND "total_cents" > 0/);
  });

  it("uses a Producer-import first trigger and changes only the imported reminder default", () => {
    expect(schema.purchaseInstallments.remindersEnabled.default).toBe(true);
    expect(migration).toMatch(
      /purchase_source_kind = 'imported_existing_work'[\s\S]*"due_trigger"::text <> 'producer_import'/,
    );
    expect(migration).toMatch(
      /purchase_source_kind <> 'imported_existing_work'[\s\S]*"due_trigger"::text <> 'acceptance'/,
    );
    expect(migration).toContain("SKITZA_IMPORTED_INSTALLMENT_REMINDERS_MUST_START_OFF");
    expect(migration).toMatch(
      /CREATE TRIGGER "purchase_installments_import_reminders_default"\s+BEFORE INSERT ON "purchase_installments"/,
    );
    expect(migration).not.toMatch(
      /purchase_installments_import_reminders_default"\s+BEFORE INSERT OR UPDATE/,
    );
    expect(migration).toContain("purchase_import_attestations_validate_schedule");
    expect(purchaseFoundationMigration).toContain(
      'CREATE TRIGGER "purchase_installments_reject_accepted_append"',
    );
    expect(migration).not.toContain("purchase_installments_reject_attested_append");
    expect(migration).toMatch(
      /purchase_acceptances[\s\S]*OR EXISTS \([\s\S]*purchase_import_attestations[\s\S]*SKITZA_PURCHASE_INSTALLMENT_SCHEDULE_SEALED/,
    );
  });

  it("stores resumable drafts and one immutable all-or-none creation result per row", () => {
    expect(foreignKeys(schema.activeWorkImportBatches)).toEqual(
      expect.arrayContaining([
        "active_work_import_batches_producer_fk",
        "active_work_import_batches_creating_producer_fk",
      ]),
    );
    expect(schema.activeWorkImportRows.draftPayload.notNull).toBe(true);
    expect(schema.activeWorkImportRows.operationKey.notNull).toBe(true);
    expect(schema.activeWorkImportRows.createdClientContactId.notNull).toBe(false);
    expect(schema.activeWorkImportRows.createdProjectId.notNull).toBe(false);
    expect(schema.activeWorkImportRows.createdPurchaseId.notNull).toBe(false);
    expect(uniqueConstraints(schema.activeWorkImportRows)).toContain(
      "active_work_import_rows_operation_unique",
    );
    expect(indexes(schema.activeWorkImportRows)).toEqual(
      expect.arrayContaining([
        "active_work_import_rows_created_project_unique",
        "active_work_import_rows_created_purchase_unique",
      ]),
    );
    expect(checks(schema.activeWorkImportRows)).toContain("active_work_import_rows_result_shape");
    expect(migration).toMatch(
      /created_client_contact_id" IS NULL[\s\S]*created_project_id" IS NULL[\s\S]*created_purchase_id" IS NULL[\s\S]*OR \([\s\S]*created_client_contact_id" IS NOT NULL[\s\S]*created_project_id" IS NOT NULL[\s\S]*created_purchase_id" IS NOT NULL/,
    );
    expect(migration).toMatch(
      /"materialized_at" IS NOT NULL[\s\S]*"last_attempted_at" IS NOT NULL[\s\S]*"last_error_code" IS NULL/,
    );
    expect(migration).toContain("SKITZA_ACTIVE_WORK_CREATED_ROW_IMMUTABLE");
    expect(migration).toContain("SKITZA_ACTIVE_WORK_CREATED_ROW_DELETE_FORBIDDEN");
  });

  it("binds each finish-setup intent before side effects with an immutable owned receipt", () => {
    expect(
      getTableConfig(schema.activeWorkImportSetupOperations).columns.map((column) => column.name),
    ).toEqual([
      "id",
      "producer_id",
      "batch_id",
      "operation_key",
      "operation_digest",
      "requested_by_clerk_user_id",
      "created_at",
    ]);
    expect(schema.activeWorkImportSetupOperations.operationKey.notNull).toBe(true);
    expect(schema.activeWorkImportSetupOperations.operationDigest.notNull).toBe(true);
    expect(schema.activeWorkImportSetupOperations.requestedByClerkUserId.notNull).toBe(true);
    expect(schema.activeWorkImportSetupOperations.createdAt.notNull).toBe(true);
    expect(schema.activeWorkImportSetupOperations.createdAt.hasDefault).toBe(true);
    expect(uniqueConstraints(schema.activeWorkImportSetupOperations)).toContain(
      "active_work_import_setup_operations_operation_unique",
    );
    expect(foreignKeys(schema.activeWorkImportSetupOperations)).toEqual(
      expect.arrayContaining([
        "active_work_import_setup_operations_batch_producer_fk",
        "active_work_import_setup_operations_requesting_producer_fk",
      ]),
    );
    expect(checks(schema.activeWorkImportSetupOperations)).toEqual(
      expect.arrayContaining([
        "active_work_import_setup_operations_operation_shape",
        "active_work_import_setup_operations_timestamp_shape",
      ]),
    );
    expect(migration).toMatch(
      /active_work_import_setup_operations_operation_unique"\s+UNIQUE \("producer_id", "batch_id", "operation_key"\)/,
    );
    expect(migration).toMatch(
      /active_work_import_setup_operations_batch_producer_fk"\s+FOREIGN KEY \("batch_id", "producer_id"\)\s+REFERENCES "active_work_import_batches" \("id", "producer_id"\)/,
    );
    expect(migration).toMatch(
      /active_work_import_setup_operations_requesting_producer_fk"\s+FOREIGN KEY \("producer_id", "requested_by_clerk_user_id"\)\s+REFERENCES "producers" \("id", "clerk_user_id"\)/,
    );
    expect(migration).toMatch(
      /operation_digest binds a kind\/version discriminator,[\s\S]*batchId, expectedSetupDigest, sorted deduplicated Client IDs,[\s\S]*deduplicated installment IDs/,
    );
    expect(migration).toMatch(
      /active_work_import_setup_operations_operation_shape" CHECK \([\s\S]*"operation_digest" ~ '\^sha256:\[0-9a-f\]\{64\}\$'/,
    );
    expect(migration).toContain('CHECK (isfinite("created_at"))');
    expect(migration).toMatch(
      /CREATE TRIGGER "active_work_import_setup_operations_append_only"\s+BEFORE UPDATE OR DELETE ON "active_work_import_setup_operations"[\s\S]*EXECUTE FUNCTION "prevent_append_only_mutation"\(\)/,
    );
  });

  it("makes provider acceptance the only durable Invited evidence", () => {
    expect(schema.clientInvitationEmailDeliveryStatus.enumValues).toEqual([
      "reserved",
      "sending",
      "provider_accepted",
      "failed",
      "dedupe_expired",
    ]);
    expect(schema.clientInvitationEmailDeliveries.providerIdempotencyKey.notNull).toBe(true);
    expect(schema.clientInvitationEmailDeliveries.providerMessageId.notNull).toBe(false);
    expect(schema.clientInvitationEmailDeliveries.providerAcceptedAt.notNull).toBe(false);
    expect(foreignKeys(schema.clientInvitationEmailDeliveries)).toEqual(
      expect.arrayContaining([
        "client_invitation_email_deliveries_client_producer_fk",
        "client_invitation_email_deliveries_requesting_producer_fk",
      ]),
    );
    expect(uniqueConstraints(schema.clientInvitationEmailDeliveries)).toEqual(
      expect.arrayContaining([
        "client_invitation_email_deliveries_operation_unique",
        "client_invitation_email_deliveries_provider_idempotency_unique",
      ]),
    );
    expect(migration).toMatch(
      /"status" = 'provider_accepted'[\s\S]*"provider_message_id"[\s\S]*"provider_accepted_at" IS NOT NULL/,
    );
    expect(migration).toMatch(
      /client_invitation_email_deliveries_recipient_shape" CHECK \(\([\s\S]*"message_snapshot"->>'to' = "recipient_email"[\s\S]*\) IS TRUE\)/,
    );
    expect(migration).toContain("SKITZA_CLIENT_INVITATION_EMAIL_INTENT_IMMUTABLE");
    expect(migration).not.toMatch(/'copy'|'whatsapp'/i);
    expect(migration).not.toMatch(/inbox[_ ]delivered/i);
  });
});
