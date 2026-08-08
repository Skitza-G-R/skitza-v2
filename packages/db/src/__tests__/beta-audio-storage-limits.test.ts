import { readFileSync } from "node:fs";
import { join } from "node:path";

import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import { firstVersionUploadIntents, trackVersions } from "../schema";

const migration = readFileSync(
  join(process.cwd(), "drizzle/0041_beta_audio_storage_limits.sql"),
  "utf8",
);
const firstVersionFoundationMigration = readFileSync(
  join(process.cwd(), "drizzle/0039_atomic_first_version_uploads.sql"),
  "utf8",
);

describe("SK-196 beta audio storage schema", () => {
  it("keeps legacy oversized rows mutable while enforcing decimal 100MB on size writes", () => {
    expect(firstVersionFoundationMigration).toMatch(/"audio_size_bytes"\s*<=\s*524288000/);
    expect(migration).not.toContain('DROP CONSTRAINT "first_version_upload_intents_content_shape"');
    expect(migration).not.toContain("NOT VALID");
    expect(migration).toMatch(
      /CREATE TRIGGER "track_versions_pending_audio_size_limit"[\s\S]*BEFORE INSERT OR UPDATE OF "pending_audio_size_bytes" ON "track_versions"/,
    );
    expect(migration).toMatch(
      /CREATE TRIGGER "first_version_upload_intents_audio_size_limit"[\s\S]*BEFORE INSERT OR UPDATE OF "audio_size_bytes" ON "first_version_upload_intents"/,
    );
    expect(migration).toContain("SKITZA_TRACK_VERSION_PENDING_AUDIO_SIZE_LIMIT");
    expect(migration).toContain("SKITZA_FIRST_VERSION_UPLOAD_SIZE_LIMIT");
    expect(migration.match(/> 100000000/g)).toHaveLength(2);
  });

  it("indexes both quota sources without adding a legacy-hostile CHECK", () => {
    const config = getTableConfig(trackVersions);
    expect(config.indexes.map((index) => index.config.name)).toEqual(
      expect.arrayContaining([
        "track_versions_producer_stored_audio_idx",
        "track_versions_producer_pending_audio_idx",
      ]),
    );
    expect(migration).not.toContain('ADD CONSTRAINT "track_versions_pending_audio_size_limit"');
  });

  it("records physical R2 deletion separately from the logical tombstone", () => {
    expect(trackVersions.audioStorageDeletedAt.notNull).toBe(false);
    expect(getTableConfig(trackVersions).checks.map((check) => check.name)).toContain(
      "track_versions_audio_storage_deleted_shape",
    );
    expect(migration).toContain('ADD COLUMN "audio_storage_deleted_at"');
    expect(migration).toContain('"audio_deleted_at" IS NOT NULL');
  });

  it("keeps V1 quota reserved until an exact permanent staging seal is durable", () => {
    const config = getTableConfig(firstVersionUploadIntents);
    expect(firstVersionUploadIntents.latestUploadUrlExpiresAt.notNull).toBe(false);
    expect(firstVersionUploadIntents.uploadUrlWriteOnceProtectedAt.notNull).toBe(false);
    expect(firstVersionUploadIntents.legacyUploadCapabilitiesRevokedAt.notNull).toBe(false);
    expect(firstVersionUploadIntents.stagingSealedAt.notNull).toBe(false);
    expect(config.checks.map((check) => check.name)).toContain(
      "first_version_upload_intents_staging_seal_shape",
    );
    expect(config.indexes.map((index) => index.config.name)).toContain(
      "first_version_upload_intents_producer_unsealed_idx",
    );
    expect(migration).toContain('ADD COLUMN "latest_upload_url_expires_at"');
    expect(migration).toContain('ADD COLUMN "legacy_upload_capabilities_revoked_at"');
    expect(migration).toContain('ADD COLUMN "upload_url_write_once_protected_at"');
    expect(migration).toContain('ADD COLUMN "staging_sealed_at"');
    expect(migration).toMatch(
      /SET "latest_upload_url_expires_at" = transaction_timestamp\(\) \+ interval '15 minutes'/,
    );
    expect(migration).not.toMatch(/SET "legacy_upload_capabilities_revoked_at"/);
    // Rollout may release legacy rows only after the old credential is revoked,
    // the operator marks exact rows, and explicit reconciliation proves cleanup.
    expect(migration).toContain("Rollout order is mandatory: rotate/revoke the old R2 signing credential");
    expect(migration).toContain("Application code must never populate this gate");
    expect(migration).toMatch(
      /WHERE "staging_sealed_at" IS NULL/,
    );
  });

  it("records write-once multipart completion protection without upgrading legacy attempts", () => {
    expect(trackVersions.pendingAudioCompleteWriteOnceProtectedAt.notNull).toBe(false);
    expect(getTableConfig(trackVersions).checks.map((check) => check.name)).toContain(
      "track_versions_pending_audio_complete_write_once_shape",
    );
    expect(migration).toContain('ADD COLUMN "pending_audio_complete_write_once_protected_at"');
    expect(migration).toContain(
      '"pending_audio_complete_write_once_protected_at" = "pending_audio_complete_attempted_at"',
    );
    expect(migration).not.toContain('SET "pending_audio_complete_write_once_protected_at"');
  });
});
