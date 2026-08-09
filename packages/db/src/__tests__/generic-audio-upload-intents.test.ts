import { readFileSync } from "node:fs";
import { join } from "node:path";

import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import { firstVersionUploadIntents } from "../schema";

const migration = readFileSync(
  join(process.cwd(), "drizzle/0048_generic_audio_upload_intents.sql"),
  "utf8",
);
const config = getTableConfig(firstVersionUploadIntents);

describe("SK-197 generic file-first audio upload intents", () => {
  it("stages the file before destination and metadata are bound", () => {
    expect(firstVersionUploadIntents.projectId.notNull).toBe(false);
    expect(firstVersionUploadIntents.purchaseId.notNull).toBe(false);
    expect(firstVersionUploadIntents.title.notNull).toBe(false);
    expect(firstVersionUploadIntents.label.notNull).toBe(false);
    expect(firstVersionUploadIntents.createsTrack.notNull).toBe(false);
    expect(firstVersionUploadIntents.finalizationDigest.notNull).toBe(false);

    expect(firstVersionUploadIntents.requestDigest.notNull).toBe(true);
    expect(firstVersionUploadIntents.trackId.notNull).toBe(true);
    expect(firstVersionUploadIntents.versionId.notNull).toBe(true);
    expect(firstVersionUploadIntents.audioContentType.notNull).toBe(true);
    expect(firstVersionUploadIntents.audioSizeBytes.notNull).toBe(true);

    for (const column of ["project_id", "purchase_id", "title", "label"]) {
      expect(migration).toContain(`ALTER COLUMN "${column}" DROP NOT NULL`);
    }
  });

  it("backfills every legacy intent before allowing the generic shape", () => {
    const backfillAt = migration.indexOf('UPDATE "first_version_upload_intents"');
    const nullableAt = migration.indexOf('ALTER COLUMN "project_id" DROP NOT NULL');
    const finalizationGuardAt = migration.indexOf(
      'ADD CONSTRAINT "first_version_upload_intents_finalization_shape"',
    );

    expect(backfillAt).toBeGreaterThan(-1);
    expect(nullableAt).toBeGreaterThan(backfillAt);
    expect(finalizationGuardAt).toBeGreaterThan(nullableAt);
    expect(migration).toMatch(
      /UPDATE "first_version_upload_intents"[\s\S]*"creates_track" = true,[\s\S]*"finalization_digest" = "request_digest"/,
    );
    expect(migration).not.toMatch(/SET[\s\S]*"request_digest"\s*=/);
  });

  it("upgrades legacy writes from an older server during a rolling deploy", () => {
    const columnsAt = migration.indexOf('ADD COLUMN "finalization_digest"');
    const functionAt = migration.indexOf(
      'CREATE FUNCTION "public"."upgrade_legacy_first_version_upload_intent"()',
    );
    const triggerAt = migration.indexOf(
      'CREATE TRIGGER "first_version_upload_intents_legacy_binding_compat"',
    );
    const backfillAt = migration.indexOf('UPDATE "first_version_upload_intents"');
    const triggerFunction = migration.slice(functionAt, triggerAt);

    expect(functionAt).toBeGreaterThan(columnsAt);
    expect(triggerAt).toBeGreaterThan(functionAt);
    expect(triggerAt).toBeLessThan(backfillAt);
    for (const legacyField of ["project_id", "purchase_id", "title", "label"]) {
      expect(triggerFunction).toContain(`NEW."${legacyField}" IS NOT NULL`);
    }
    expect(triggerFunction).toContain('NEW."creates_track" IS NULL');
    expect(triggerFunction).toContain('NEW."finalization_digest" IS NULL');
    expect(triggerFunction).toContain('NEW."creates_track" := true');
    expect(triggerFunction).toContain('NEW."finalization_digest" := NEW."request_digest"');
    expect(migration).not.toMatch(
      /ADD COLUMN "(?:creates_track|finalization_digest)"[^,;]*DEFAULT/i,
    );
  });

  it("requires a complete durable binding before an intent may complete", () => {
    expect(config.checks.map((constraint) => constraint.name)).toContain(
      "first_version_upload_intents_finalization_shape",
    );
    expect(migration).toContain("\"finalization_digest\" ~ '^sha256:[0-9a-f]{64}$'");

    const completionGuard = migration.slice(
      migration.indexOf('ADD CONSTRAINT "first_version_upload_intents_finalization_shape"'),
      migration.indexOf("-- One staged file still owns one immutable Version id."),
    );
    for (const requiredColumn of [
      "project_id",
      "purchase_id",
      "title",
      "label",
      "creates_track",
      "finalization_digest",
    ]) {
      expect(completionGuard).toContain(`"${requiredColumn}" IS NOT NULL`);
    }
    expect(completionGuard).toContain('"completed_at" IS NULL');
    expect(completionGuard).toMatch(
      /"finalization_digest" IS NULL[\s\S]*"creates_track" IS NULL[\s\S]*"project_id" IS NULL[\s\S]*"purchase_id" IS NULL[\s\S]*"title" IS NULL[\s\S]*"label" IS NULL/,
    );
  });

  it("keeps one immutable Version id while allowing retries to rebind a track", () => {
    const uniqueNames = config.uniqueConstraints.map((constraint) => constraint.name);
    expect(uniqueNames).toContain("first_version_upload_intents_version_unique");
    expect(uniqueNames).not.toContain("first_version_upload_intents_track_unique");
    expect(config.indexes.map((index) => index.config.name)).toContain(
      "first_version_upload_intents_track_idx",
    );

    expect(migration).toContain('DROP CONSTRAINT "first_version_upload_intents_track_unique"');
    expect(migration).toContain('CREATE INDEX "first_version_upload_intents_track_idx"');
    expect(migration).not.toContain(
      'DROP CONSTRAINT "first_version_upload_intents_version_unique"',
    );
  });

  it("preserves storage safety and does not rewrite durable music", () => {
    expect(config.foreignKeys.map((key) => key.getName())).toEqual(
      expect.arrayContaining([
        "first_version_upload_intents_project_producer_fk",
        "first_version_upload_intents_purchase_project_fk",
        "first_version_upload_intents_purchase_producer_fk",
      ]),
    );
    expect(config.checks.map((constraint) => constraint.name)).toEqual(
      expect.arrayContaining([
        "first_version_upload_intents_identity_shape",
        "first_version_upload_intents_content_shape",
        "first_version_upload_intents_state_shape",
        "first_version_upload_intents_staging_seal_shape",
      ]),
    );
    expect(migration).toContain(
      'LOCK TABLE "first_version_upload_intents" IN ACCESS EXCLUSIVE MODE NOWAIT',
    );
    expect(migration).not.toMatch(/ALTER TABLE\s+"(?:project_tracks|track_versions)"/i);
    expect(migration).not.toMatch(/DROP (?:TABLE|COLUMN|TRIGGER|FUNCTION)/i);
    expect(migration).not.toContain('UPDATE "project_tracks"');
    expect(migration).not.toContain('UPDATE "track_versions"');
  });
});
