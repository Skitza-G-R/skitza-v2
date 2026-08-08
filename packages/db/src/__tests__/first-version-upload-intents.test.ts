import { readFileSync } from "node:fs";
import { join } from "node:path";

import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import { firstVersionUploadIntents } from "../schema";

const migration = readFileSync(
  join(process.cwd(), "drizzle/0039_atomic_first_version_uploads.sql"),
  "utf8",
);
const config = getTableConfig(firstVersionUploadIntents);

describe("SK-163 atomic first Version upload schema", () => {
  it("stores a retryable upload intent without creating a Song or Version", () => {
    expect(firstVersionUploadIntents.projectId.notNull).toBe(false);
    expect(firstVersionUploadIntents.purchaseId.notNull).toBe(false);
    expect(firstVersionUploadIntents.trackId.notNull).toBe(true);
    expect(firstVersionUploadIntents.versionId.notNull).toBe(true);
    expect(firstVersionUploadIntents.completedAt.notNull).toBe(false);
    expect(firstVersionUploadIntents.canceledAt.notNull).toBe(false);
    expect(config.uniqueConstraints.map((constraint) => constraint.name)).toEqual(
      expect.arrayContaining([
        "first_version_upload_intents_operation_unique",
        "first_version_upload_intents_version_unique",
        "first_version_upload_intents_staging_audio_key_unique",
        "first_version_upload_intents_audio_key_unique",
      ]),
    );
    expect(config.uniqueConstraints.map((constraint) => constraint.name)).not.toContain(
      "first_version_upload_intents_track_unique",
    );
    expect(config.indexes.map((index) => index.config.name)).toContain(
      "first_version_upload_intents_track_idx",
    );
  });

  it("pins the exact producer, Project, purchase, and object-state invariants", () => {
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
        "first_version_upload_intents_finalization_shape",
      ]),
    );
  });

  it("adds only the temporary intent table and never rewrites durable music", () => {
    expect(migration).toContain('CREATE TABLE "first_version_upload_intents"');
    expect(migration).toContain('CREATE INDEX "first_version_upload_intents_producer_state_idx"');
    expect(migration).not.toMatch(/ALTER TABLE\s+"(?:project_tracks|track_versions)"/i);
    expect(migration).not.toMatch(/\b(?:UPDATE|DELETE FROM|TRUNCATE|DROP TABLE)\b/i);
  });
});
