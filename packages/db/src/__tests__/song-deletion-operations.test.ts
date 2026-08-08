import { readFileSync } from "node:fs";
import { join } from "node:path";

import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import { songDeletionOperations } from "../schema";

const migration = readFileSync(
  join(process.cwd(), "drizzle/0042_song_history_hard_deletion.sql"),
  "utf8",
);
const config = getTableConfig(songDeletionOperations);

describe("SK-196 durable Song and Version deletion", () => {
  it("keeps an idempotent operation receipt after its target history is removed", () => {
    expect(songDeletionOperations.trackId.notNull).toBe(true);
    expect(songDeletionOperations.versionId.notNull).toBe(false);
    expect(songDeletionOperations.audioManifest.notNull).toBe(true);
    expect(songDeletionOperations.firstVersionStagingManifest.notNull).toBe(true);
    expect(songDeletionOperations.firstVersionFinalManifest.notNull).toBe(true);
    expect(songDeletionOperations.peaksManifest.notNull).toBe(true);
    expect(songDeletionOperations.storageVerifiedAt.notNull).toBe(false);
    expect(songDeletionOperations.completedAt.notNull).toBe(false);
    expect(config.uniqueConstraints.map((constraint) => constraint.name)).toContain(
      "song_deletion_operations_producer_operation_unique",
    );
    expect(config.foreignKeys.map((key) => key.getName())).toEqual([
      "song_deletion_operations_producer_id_producers_id_fk",
    ]);
    expect(migration).not.toContain("IF NOT EXISTS");
    expect(migration).toContain('"target_version_ids" jsonb NOT NULL');
    expect(migration).toContain("\"artwork_manifest\" jsonb DEFAULT '[]'::jsonb NOT NULL");
    expect(migration).toContain(
      "\"first_version_staging_manifest\" jsonb DEFAULT '[]'::jsonb NOT NULL",
    );
    expect(migration).toContain(
      "\"first_version_final_manifest\" jsonb DEFAULT '[]'::jsonb NOT NULL",
    );
    expect(migration).toContain("\"peaks_manifest\" jsonb DEFAULT '[]'::jsonb NOT NULL");
  });

  it("keeps an exact Version target while allowing an empty Song and storage manifests", () => {
    expect(config.checks.map((constraint) => constraint.name)).toEqual(
      expect.arrayContaining([
        "song_deletion_operations_identity_shape",
        "song_deletion_operations_target_shape",
        "song_deletion_operations_manifest_shape",
        "song_deletion_operations_timestamp_shape",
      ]),
    );
    expect(migration).toMatch(
      /"kind" = 'version'[\s\S]*jsonb_array_length\("target_version_ids"\) = 1/,
    );
    expect(migration).toMatch(/OR \("kind" = 'song' AND "version_id" IS NULL\)/);
    expect(migration).not.toMatch(/jsonb_array_length\("target_version_ids"\) > 0/);
    expect(migration).toMatch(/"target_version_ids" \? "version_id"::text/);
    expect(migration).toContain("jsonb_typeof(\"audio_manifest\") = 'array'");
    expect(migration).toContain("jsonb_typeof(\"artwork_manifest\") = 'array'");
    expect(migration).toContain("jsonb_typeof(\"first_version_staging_manifest\") = 'array'");
    expect(migration).toContain("jsonb_typeof(\"first_version_final_manifest\") = 'array'");
    expect(migration).toContain("jsonb_typeof(\"peaks_manifest\") = 'array'");
    expect(migration).toContain('"audio_bytes" >= 0');
    expect(migration).not.toMatch(/jsonb_array_length\("audio_manifest"\) > 0/);
  });

  it("freezes operation identity and advances verification and completion once", () => {
    expect(migration).toMatch(
      /CREATE TRIGGER "song_deletion_operations_protect_state"[\s\S]*BEFORE INSERT OR UPDATE OR DELETE ON "song_deletion_operations"/,
    );
    for (const immutableField of [
      'OLD."target_version_ids"',
      'OLD."audio_manifest"',
      'OLD."artwork_manifest"',
      'OLD."first_version_staging_manifest"',
      'OLD."first_version_final_manifest"',
      'OLD."peaks_manifest"',
      'OLD."audio_bytes"',
    ]) {
      expect(migration).toContain(immutableField);
    }
    expect(migration).toContain("SKITZA_SONG_DELETION_OPERATION_INITIAL_STATE");
    expect(migration).toContain("SKITZA_SONG_DELETION_OPERATION_IDENTITY_IMMUTABLE");
    expect(migration).toContain("SKITZA_SONG_DELETION_OPERATION_STORAGE_STATE_IMMUTABLE");
    expect(migration).toContain("SKITZA_SONG_DELETION_OPERATION_COMPLETION_IMMUTABLE");
    expect(migration).toContain("SKITZA_SONG_DELETION_OPERATION_STORAGE_VERIFICATION_REQUIRED");
  });

  it("requires exact R2 verification before a deletion may be completed", () => {
    expect(migration).toContain('"storage_verified_at" timestamptz');
    expect(migration).toMatch(/"completed_at" IS NULL[\s\S]*"storage_verified_at" IS NOT NULL/);
  });

  it("binds every deletion guard to one exact verified incomplete operation", () => {
    expect(migration).toContain("current_setting('skitza.song_deletion_operation_id', true)");
    expect(migration).not.toContain("skitza.allow_song_history_delete");
    expect(migration).toMatch(
      /operation\."producer_id" = expected_producer_id[\s\S]*operation\."project_id" = expected_project_id[\s\S]*operation\."purchase_id" = expected_purchase_id[\s\S]*operation\."track_id" = expected_track_id/,
    );
    expect(migration).toMatch(
      /operation\."storage_verified_at" IS NOT NULL[\s\S]*operation\."completed_at" IS NULL/,
    );
    expect(migration).toMatch(/operation\."target_version_ids" \? expected_version_id::text/);
    expect(migration).toContain("SKITZA_PROJECT_TRACK_DELETE_FORBIDDEN");
    expect(migration).toContain("SKITZA_TRACK_VERSION_DELETE_FORBIDDEN");
    expect(migration).toContain("SKITZA_APPEND_ONLY_HISTORY_IMMUTABLE");
    for (const trigger of [
      "purchase_download_overrides_append_only",
      "version_approval_events_append_only",
      "song_public_access_events_append_only",
      "artist_historical_access_grants_append_only",
    ]) {
      expect(migration).toContain(`CREATE TRIGGER "${trigger}"`);
    }
    expect(migration).toMatch(
      /CREATE OR REPLACE FUNCTION "protect_project_track_identity"\(\)[\s\S]*"song_deletion_operation_allows"\([\s\S]*NULL,[\s\S]*true/,
    );
    expect(migration).not.toMatch(
      /DROP TRIGGER IF EXISTS "(?:purchase_acceptances|purchase_payments)/,
    );
  });

  it("blocks Song, Version, comment, and public-link races while deletion is in progress", () => {
    expect(migration).toMatch(
      /CREATE TRIGGER "track_comments_reject_deleting_version"[\s\S]*BEFORE INSERT ON "track_comments"/,
    );
    expect(migration).toMatch(/SELECT version\."audio_deleted_at"[\s\S]*FOR SHARE/);
    expect(migration).toContain("SKITZA_TRACK_COMMENT_TARGET_DELETING");
    expect(migration).toContain("SKITZA_PROJECT_TRACK_DELETION_IN_PROGRESS");
    expect(migration).toContain("SKITZA_TRACK_VERSION_DELETION_IN_PROGRESS");
    expect(migration).toMatch(
      /operation\."track_id" = OLD\."id"[\s\S]*operation\."completed_at" IS NULL/,
    );
    expect(migration).toMatch(
      /operation\."producer_id" = OLD\."producer_id"[\s\S]*operation\."purchase_id" = OLD\."purchase_id"[\s\S]*operation\."track_id" = OLD\."track_id"[\s\S]*operation\."completed_at" IS NULL/,
    );
    expect(migration).toMatch(/operation\."target_version_ids" \? NEW\."version_id"::text/);
    expect(migration).toMatch(
      /CREATE TRIGGER "track_versions_reject_deleting_song_insert"[\s\S]*BEFORE INSERT ON "track_versions"/,
    );
    expect(migration).toMatch(
      /CREATE TRIGGER "song_public_links_reject_deleting_song"[\s\S]*BEFORE INSERT OR UPDATE ON "song_public_links"/,
    );
    expect(migration).toContain("SKITZA_SONG_PUBLIC_LINK_DELETION_IN_PROGRESS");
  });

  it("rejects public-link insert and update for the exact pending Song scope", () => {
    const publicLinkGuard = migration.slice(
      migration.indexOf('CREATE OR REPLACE FUNCTION "reject_public_link_change_for_deleting_song"'),
      migration.indexOf('CREATE TRIGGER "song_public_links_reject_deleting_song"'),
    );
    const trigger = migration.slice(
      migration.indexOf('CREATE TRIGGER "song_public_links_reject_deleting_song"'),
      migration.indexOf('CREATE OR REPLACE FUNCTION "protect_project_track_identity"'),
    );

    expect(publicLinkGuard).toContain('operation."producer_id" = NEW."producer_id"');
    expect(publicLinkGuard).toContain('operation."purchase_id" = NEW."purchase_id"');
    expect(publicLinkGuard).toContain('operation."track_id" = NEW."track_id"');
    expect(publicLinkGuard).toContain('operation."completed_at" IS NULL');
    expect(publicLinkGuard).toContain(
      "RAISE EXCEPTION 'SKITZA_SONG_PUBLIC_LINK_DELETION_IN_PROGRESS'",
    );
    expect(trigger).toMatch(/BEFORE INSERT OR UPDATE ON "song_public_links"/);
  });
});
