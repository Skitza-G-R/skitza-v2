import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import { getTableConfig, type PgTable } from "drizzle-orm/pg-core";

import { portfolioTracks, purchaseDownloadOverrideEvents, trackVersions } from "../schema";

const migration = readFileSync(
  join(process.cwd(), "drizzle/0033_purchase_version_download_overrides.sql"),
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

describe("SK-40 purchase-version download override schema", () => {
  it("stores ordered, intent-idempotent override history for one exact purchase version", () => {
    expect(purchaseDownloadOverrideEvents.sequence.notNull).toBe(true);
    expect(purchaseDownloadOverrideEvents.operationKey.notNull).toBe(true);
    expect(purchaseDownloadOverrideEvents.operationDigest.notNull).toBe(true);
    expect(purchaseDownloadOverrideEvents.changedByClerkUserId.notNull).toBe(true);

    expect(uniqueNames(purchaseDownloadOverrideEvents)).toEqual(
      expect.arrayContaining([
        "purchase_download_overrides_purchase_version_sequence_unique",
        "purchase_download_overrides_operation_key_unique",
      ]),
    );
    expect(checkNames(purchaseDownloadOverrideEvents)).toEqual(
      expect.arrayContaining([
        "purchase_download_overrides_positive_sequence",
        "purchase_download_overrides_operation_shape",
        "purchase_download_overrides_actor_shape",
      ]),
    );
    expect(foreignKeyNames(purchaseDownloadOverrideEvents)).toEqual(
      expect.arrayContaining([
        "purchase_download_overrides_purchase_producer_fk",
        "purchase_download_overrides_version_purchase_fk",
      ]),
    );
    expect(indexNames(purchaseDownloadOverrideEvents)).toContain(
      "purchase_download_overrides_version_sequence_idx",
    );
    expect(indexNames(purchaseDownloadOverrideEvents)).not.toContain(
      "purchase_download_overrides_version_created_idx",
    );
  });

  it("backfills deterministic order while preserving append-only protection", () => {
    expect(migration).toMatch(
      /LOCK TABLE "purchase_download_override_events" IN ACCESS EXCLUSIVE MODE NOWAIT/,
    );
    expect(migration).toMatch(
      /row_number\(\) OVER \(\s*PARTITION BY "purchase_id", "version_id"\s*ORDER BY "created_at", "id"/,
    );
    expect(migration).toContain(`'legacy:purchase-download-override:' || "id"::text`);
    expect(migration).toContain(`'legacy:purchase-download-override-digest:' || "id"::text`);
    expect(migration).toMatch(/ALTER COLUMN "operation_key" DROP EXPRESSION/);
    expect(migration).toMatch(/ALTER COLUMN "operation_digest" DROP EXPRESSION/);
    expect(migration).toMatch(
      /ADD CONSTRAINT "purchase_download_overrides_purchase_version_sequence_unique"\s+UNIQUE \("purchase_id", "version_id", "sequence"\)/,
    );
    expect(migration).toMatch(
      /ADD CONSTRAINT "purchase_download_overrides_operation_key_unique"\s+UNIQUE \("purchase_id", "operation_key"\)/,
    );
    expect(migration).toMatch(
      /CREATE INDEX "purchase_download_overrides_version_sequence_idx"\s+ON "purchase_download_override_events" \("purchase_id", "version_id", "sequence"\)/,
    );
    expect(migration).not.toMatch(/\b(?:DELETE FROM|TRUNCATE|DROP TABLE)\b/);

    const lockAt = migration.indexOf(
      'LOCK TABLE "purchase_download_override_events" IN ACCESS EXCLUSIVE MODE NOWAIT',
    );
    const trackLockAt = migration.indexOf(
      'LOCK TABLE "track_versions" IN ACCESS EXCLUSIVE MODE NOWAIT',
    );
    const portfolioLockAt = migration.indexOf(
      'LOCK TABLE "portfolio_tracks" IN ACCESS EXCLUSIVE MODE NOWAIT',
    );
    const dropTriggerAt = migration.indexOf(
      'DROP TRIGGER "purchase_download_overrides_append_only"',
    );
    const backfillAt = migration.indexOf('UPDATE "purchase_download_override_events" AS event');
    const requireSequenceAt = migration.indexOf('ALTER COLUMN "sequence" SET NOT NULL');
    const restoreTriggerAt = migration.indexOf(
      'CREATE TRIGGER "purchase_download_overrides_append_only"',
    );

    expect(lockAt).toBeGreaterThanOrEqual(0);
    expect(trackLockAt).toBeGreaterThanOrEqual(0);
    expect(trackLockAt).toBeLessThan(portfolioLockAt);
    expect(portfolioLockAt).toBeLessThan(lockAt);
    expect(lockAt).toBeLessThan(dropTriggerAt);
    expect(dropTriggerAt).toBeLessThan(backfillAt);
    expect(backfillAt).toBeLessThan(requireSequenceAt);
    expect(requireSequenceAt).toBeLessThan(restoreTriggerAt);
    expect(migration.slice(restoreTriggerAt)).toMatch(
      /BEFORE UPDATE OR DELETE[\s\S]*prevent_append_only_mutation/,
    );
  });

  it("replaces owned permanent URLs with protected stream paths", () => {
    expect(checkNames(trackVersions)).toContain("track_versions_protected_audio_url");
    expect(checkNames(portfolioTracks)).toContain("portfolio_tracks_protected_owned_audio_url");
    expect(migration).toMatch(
      /UPDATE "track_versions"[\s\S]*'\/api\/audio\/stream\/' \|\| "id"::text/,
    );
    expect(migration).toMatch(
      /UPDATE "portfolio_tracks" AS portfolio[\s\S]*'\/api\/audio\/public\/portfolio\/' \|\| portfolio\."id"::text/,
    );
    expect(migration).toMatch(/ADD CONSTRAINT "track_versions_protected_audio_url"/);
    expect(migration).toMatch(/ADD CONSTRAINT "portfolio_tracks_protected_owned_audio_url"/);
  });
});
