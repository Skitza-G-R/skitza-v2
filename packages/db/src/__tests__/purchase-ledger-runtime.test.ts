import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import { getTableConfig, type PgTable } from "drizzle-orm/pg-core";

import * as schema from "../schema";

const migration = readFileSync(
  join(process.cwd(), "drizzle/0031_purchase_ledger_runtime.sql"),
  "utf8",
);

function config(table: PgTable) {
  return getTableConfig(table);
}

function uniqueNames(table: PgTable): string[] {
  return config(table)
    .uniqueConstraints.map((constraint) => constraint.name)
    .filter((name): name is string => name !== undefined);
}

function indexNames(table: PgTable): string[] {
  return config(table)
    .indexes.map((index) => index.config.name)
    .filter((name): name is string => name !== undefined);
}

function checkNames(table: PgTable): string[] {
  return config(table).checks.map((constraint) => constraint.name);
}

function foreignKeyNames(table: PgTable): string[] {
  return config(table).foreignKeys.map((key) => key.getName());
}

describe("SK-97 purchase-ledger runtime schema", () => {
  it("makes correction, waiver, and cancellation commands intent-idempotent", () => {
    for (const table of [
      schema.purchasePaymentCorrections,
      schema.purchaseWaivers,
      schema.purchaseCancellations,
    ]) {
      expect(table.operationKey.notNull).toBe(true);
      expect(table.operationDigest.notNull).toBe(true);
    }

    expect(uniqueNames(schema.purchasePaymentCorrections)).toContain(
      "purchase_payment_corrections_operation_key_unique",
    );
    expect(uniqueNames(schema.purchaseWaivers)).toContain("purchase_waivers_operation_key_unique");
    expect(uniqueNames(schema.purchaseCancellations)).toContain(
      "purchase_cancellations_operation_key_unique",
    );
    expect(checkNames(schema.purchasePaymentCorrections)).toEqual(
      expect.arrayContaining([
        "purchase_payment_corrections_operation_shape",
        "purchase_payment_corrections_reason_shape",
        "purchase_payment_corrections_amount_changed",
      ]),
    );
    expect(checkNames(schema.purchaseWaivers)).toEqual(
      expect.arrayContaining(["purchase_waivers_operation_shape", "purchase_waivers_reason_shape"]),
    );
    expect(checkNames(schema.purchaseCancellations)).toEqual(
      expect.arrayContaining([
        "purchase_cancellations_operation_shape",
        "purchase_cancellations_reason_shape",
      ]),
    );
    expect(indexNames(schema.purchasePaymentCorrections)).toContain(
      "purchase_payment_corrections_purchase_created_idx",
    );
    expect(indexNames(schema.purchaseWaivers)).toContain("purchase_waivers_purchase_created_idx");
  });

  it("stores a tenant-bound durable reminder reservation before delivery", () => {
    expect(schema.purchaseReminderKind.enumValues).toEqual([
      "automatic_3_days_before",
      "automatic_due",
      "automatic_3_days_late",
      "automatic_weekly_late",
      "manual",
    ]);
    expect(schema.purchaseReminderDeliveryStatus.enumValues).toEqual([
      "reserved",
      "sending",
      "sent",
      "reservation_expired",
      "dedupe_expired",
    ]);
    expect(schema.purchaseReminderDeliveries.purchaseId.notNull).toBe(true);
    expect(schema.purchaseReminderDeliveries.installmentId.notNull).toBe(true);
    expect(schema.purchaseReminderDeliveries.producerId.notNull).toBe(true);
    expect(schema.purchaseReminderDeliveries.operationDigest.notNull).toBe(true);
    expect(schema.purchaseReminderDeliveries.messageSnapshot.notNull).toBe(true);
    expect(schema.purchaseReminderDeliveries.providerIdempotencyKey.notNull).toBe(true);
    expect(schema.purchaseReminderDeliveries.providerMessageId.notNull).toBe(false);
    expect(schema.purchaseReminderDeliveries.sentAt.notNull).toBe(false);
    expect(uniqueNames(schema.purchaseReminderDeliveries)).toEqual(
      expect.arrayContaining([
        "purchase_reminder_deliveries_operation_key_unique",
        "purchase_reminder_deliveries_provider_idempotency_unique",
      ]),
    );
    expect(indexNames(schema.purchaseReminderDeliveries)).toEqual(
      expect.arrayContaining([
        "purchase_reminder_deliveries_automatic_occurrence_unique",
        "purchase_reminder_deliveries_claim_idx",
        "purchase_reminder_deliveries_producer_updated_idx",
      ]),
    );
    expect(foreignKeyNames(schema.purchaseReminderDeliveries)).toEqual(
      expect.arrayContaining([
        "purchase_reminder_deliveries_purchase_producer_fk",
        "purchase_reminder_deliveries_installment_purchase_currency_fk",
      ]),
    );
    expect(checkNames(schema.purchaseReminderDeliveries)).toEqual(
      expect.arrayContaining([
        "purchase_reminder_deliveries_positive_amount",
        "purchase_reminder_deliveries_operation_shape",
        "purchase_reminder_deliveries_actor_shape",
        "purchase_reminder_deliveries_snapshot_shape",
        "purchase_reminder_deliveries_attempt_shape",
        "purchase_reminder_deliveries_state_shape",
      ]),
    );
  });

  it("stores one tenant- and currency-bound immutable log per successful reminder", () => {
    expect(schema.purchaseReminderLogs.purchaseId.notNull).toBe(true);
    expect(schema.purchaseReminderLogs.installmentId.notNull).toBe(true);
    expect(schema.purchaseReminderLogs.producerId.notNull).toBe(true);
    expect(schema.purchaseReminderLogs.operationKey.notNull).toBe(true);
    expect(schema.purchaseReminderLogs.operationDigest.notNull).toBe(true);
    expect(schema.purchaseReminderLogs.providerMessageId.notNull).toBe(true);
    expect(schema.purchaseReminderLogs.sentByClerkUserId.notNull).toBe(false);
    expect(schema.purchaseReminderLogs.sentAt.notNull).toBe(true);

    expect(uniqueNames(schema.purchaseReminderLogs)).toContain(
      "purchase_reminder_logs_operation_key_unique",
    );
    expect(indexNames(schema.purchaseReminderLogs)).toEqual(
      expect.arrayContaining([
        "purchase_reminder_logs_automatic_occurrence_unique",
        "purchase_reminder_logs_producer_sent_idx",
        "purchase_reminder_logs_installment_sent_idx",
      ]),
    );
    expect(foreignKeyNames(schema.purchaseReminderLogs)).toEqual(
      expect.arrayContaining([
        "purchase_reminder_logs_purchase_producer_fk",
        "purchase_reminder_logs_installment_purchase_currency_fk",
        "purchase_reminder_logs_delivery_operation_fk",
      ]),
    );
    expect(checkNames(schema.purchaseReminderLogs)).toEqual(
      expect.arrayContaining([
        "purchase_reminder_logs_positive_amount",
        "purchase_reminder_logs_operation_shape",
        "purchase_reminder_logs_delivery_shape",
        "purchase_reminder_logs_actor_shape",
      ]),
    );
  });

  it("audits payment-driven project pause and resume commands", () => {
    expect(schema.projectPaymentPauseAction.enumValues).toEqual(["paused", "resumed"]);
    expect(schema.projectPaymentPauseEvents.purchaseId.notNull).toBe(true);
    expect(schema.projectPaymentPauseEvents.projectId.notNull).toBe(true);
    expect(schema.projectPaymentPauseEvents.producerId.notNull).toBe(true);
    expect(schema.projectPaymentPauseEvents.operationKey.notNull).toBe(true);
    expect(schema.projectPaymentPauseEvents.operationDigest.notNull).toBe(true);
    expect(schema.projectPaymentPauseEvents.changedByClerkUserId.notNull).toBe(true);
    expect(uniqueNames(schema.projectPaymentPauseEvents)).toContain(
      "project_payment_pause_events_operation_key_unique",
    );
    expect(foreignKeyNames(schema.projectPaymentPauseEvents)).toContain(
      "project_payment_pause_events_project_producer_fk",
    );
    expect(foreignKeyNames(schema.projectPaymentPauseEvents)).toContain(
      "project_payment_pause_events_purchase_project_fk",
    );
    expect(indexNames(schema.projectPaymentPauseEvents)).toContain(
      "project_payment_pause_events_project_changed_idx",
    );
    expect(indexNames(schema.projectPaymentPauseEvents)).toContain(
      "project_payment_pause_events_purchase_changed_idx",
    );
    expect(checkNames(schema.projectPaymentPauseEvents)).toEqual(
      expect.arrayContaining([
        "project_payment_pause_events_operation_shape",
        "project_payment_pause_events_reason_shape",
        "project_payment_pause_events_actor_shape",
      ]),
    );
  });
});

describe("SK-97 purchase-ledger runtime migration", () => {
  it("backfills append-only history from immutable ids without issuing UPDATE", () => {
    expect(migration.match(/GENERATED ALWAYS AS/g)).toHaveLength(6);
    expect(migration.match(/DROP EXPRESSION/g)).toHaveLength(6);
    for (const identity of [
      "legacy:purchase-payment-correction:",
      "legacy:purchase-waiver:",
      "legacy:purchase-cancellation:",
    ]) {
      expect(migration).toContain(`${identity}' || "id"::text`);
    }
    expect(migration).not.toMatch(
      /\bUPDATE\s+"purchase_(?:payment_corrections|waivers|cancellations)"/i,
    );
  });

  it("defaults new producer reminders on without rewriting producer preferences", () => {
    expect(schema.producers.autopilotUnpaidReminder.default).toBe(true);
    expect(migration).toMatch(
      /ALTER TABLE "producers"\s+ALTER COLUMN "autopilot_unpaid_reminder" SET DEFAULT true;/,
    );
    expect(migration).not.toMatch(/\bUPDATE\s+"producers"/i);
  });

  it("anchors accepted first installments without guessing future Monthly dates", () => {
    expect(migration).toMatch(
      /UPDATE "purchase_installments" AS installment[\s\S]*"due_at" = purchase\."accepted_at"[\s\S]*"triggered_at" = purchase\."accepted_at"/,
    );
    expect(migration).toMatch(
      /installment\."position" = 1[\s\S]*installment\."due_trigger" = 'acceptance'/,
    );
    expect(migration).not.toMatch(
      /UPDATE "purchase_installments"[\s\S]*due_trigger" = 'monthly_anniversary'/,
    );
  });

  it("makes successful reminder and pause history append-only", () => {
    expect(migration).toMatch(
      /CREATE TABLE "purchase_reminder_deliveries"[\s\S]*"status" "purchase_reminder_delivery_status"[\s\S]*"provider_dedupe_expires_at"/,
    );
    expect(migration).toMatch(
      /CREATE TYPE "purchase_reminder_delivery_status"[\s\S]*'reservation_expired'/,
    );
    expect(migration).toMatch(
      /purchase_reminder_deliveries_snapshot_shape[\s\S]*message_snapshot[\s\S]*recipient_email[\s\S]*amountCents[\s\S]*amount_due_cents/,
    );
    expect(migration).toMatch(
      /protect_purchase_reminder_delivery[\s\S]*message_snapshot[\s\S]*DELIVERY_INTENT_IMMUTABLE[\s\S]*provider_dedupe_expires_at[\s\S]*DEDUPE_WINDOW_IMMUTABLE/,
    );
    expect(migration).toMatch(
      /purchase_reminder_deliveries_protect[\s\S]*BEFORE UPDATE OR DELETE ON "purchase_reminder_deliveries"/,
    );
    expect(migration).toMatch(
      /OLD\."status" IN \('sent', 'reservation_expired', 'dedupe_expired'\)/,
    );
    expect(migration).toMatch(
      /purchase_reminder_logs_append_only[\s\S]*BEFORE UPDATE OR DELETE ON "purchase_reminder_logs"[\s\S]*prevent_append_only_mutation/,
    );
    expect(migration).toMatch(
      /project_payment_pause_events_append_only[\s\S]*BEFORE UPDATE OR DELETE ON "project_payment_pause_events"[\s\S]*prevent_append_only_mutation/,
    );
    expect(migration).toMatch(
      /purchase_reminder_logs_automatic_occurrence_unique[\s\S]*installment_id[\s\S]*kind[\s\S]*scheduled_for[\s\S]*WHERE "kind" <> 'manual'/,
    );
    expect(migration).not.toMatch(/"sent_at"\s*>=\s*"scheduled_for"/);
  });

  it("allows derived paid and waived states to regress while keeping cancellation sealed", () => {
    const start = migration.indexOf(
      'CREATE OR REPLACE FUNCTION "protect_purchase_installment_terms"',
    );
    const end = migration.indexOf('CREATE TRIGGER "purchase_reminder_logs_append_only"', start);
    const guard = migration.slice(start, end);

    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    expect(guard).toContain(`OLD."status" = 'canceled'`);
    expect(guard).not.toMatch(/OLD\."status" IN \([^)]*'confirmed'/);
    expect(guard).not.toMatch(/OLD\."status" IN \([^)]*'waived'/);
    expect(guard).toContain("SKITZA_PURCHASE_INSTALLMENT_TERMINAL_STATUS_IMMUTABLE");
    expect(guard).toContain("SKITZA_PURCHASE_INSTALLMENT_DUE_AT_IMMUTABLE");
    expect(guard).toContain("SKITZA_PURCHASE_INSTALLMENT_TRIGGERED_AT_IMMUTABLE");
  });
});
