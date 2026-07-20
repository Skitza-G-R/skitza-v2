import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import { getTableConfig, type PgTable } from "drizzle-orm/pg-core";

import { projectTracks, songPublicAccessEvents, songPublicLinks, trackVersions } from "../schema";

const migration = readFileSync(join(process.cwd(), "drizzle/0034_song_public_access.sql"), "utf8");

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

describe("SK-98 public song access schema", () => {
  it("hardens the one-row-per-song public link generation", () => {
    expect(songPublicLinks.tokenHash.notNull).toBe(true);
    expect(songPublicLinks.tokenVersion.notNull).toBe(true);
    expect(uniqueNames(songPublicLinks)).toEqual(
      expect.arrayContaining([
        "song_public_links_track_unique",
        "song_public_links_exact_scope_unique",
      ]),
    );
    expect(checkNames(songPublicLinks)).toEqual(
      expect.arrayContaining([
        "song_public_links_positive_token_version",
        "song_public_links_token_hash_shape",
        "song_public_links_timestamp_shape",
      ]),
    );

    expect(migration).toMatch(
      /ADD CONSTRAINT "song_public_links_exact_scope_unique"\s+UNIQUE \("id", "track_id", "purchase_id", "producer_id"\)/,
    );
    expect(migration).toMatch(/CHECK \("token_version" > 0\)/);
    expect(migration).toContain("^sha256:[0-9a-f]{64}$");
    expect(migration).toMatch(/"disabled_at" >= "enabled_at"/);
  });

  it("stores one append-only, exact-scope event sequence for public access races", () => {
    expect(songPublicAccessEvents.linkId.notNull).toBe(false);
    expect(songPublicAccessEvents.versionId.notNull).toBe(false);
    expect(songPublicAccessEvents.tokenVersion.notNull).toBe(false);
    expect(songPublicAccessEvents.tokenHash.notNull).toBe(false);
    expect(songPublicAccessEvents.changed.notNull).toBe(true);
    expect(songPublicAccessEvents.linkEnabled.notNull).toBe(true);
    expect(songPublicAccessEvents.portfolioPublished.notNull).toBe(true);
    expect(songPublicAccessEvents.remainingAudioCount.notNull).toBe(true);
    expect(songPublicAccessEvents.operationKey.notNull).toBe(true);
    expect(songPublicAccessEvents.operationDigest.notNull).toBe(true);
    expect(songPublicAccessEvents.changedByClerkUserId.notNull).toBe(true);

    expect(uniqueNames(songPublicAccessEvents)).toEqual(
      expect.arrayContaining([
        "song_public_access_events_track_sequence_unique",
        "song_public_access_events_track_operation_unique",
      ]),
    );
    expect(foreignKeyNames(songPublicAccessEvents)).toEqual(
      expect.arrayContaining([
        "song_public_access_events_track_purchase_fk",
        "song_public_access_events_purchase_producer_fk",
        "song_public_access_events_link_scope_fk",
        "song_public_access_events_version_scope_fk",
      ]),
    );
    expect(checkNames(songPublicAccessEvents)).toEqual(
      expect.arrayContaining([
        "song_public_access_events_action_shape",
        "song_public_access_events_positive_sequence",
        "song_public_access_events_token_snapshot_shape",
        "song_public_access_events_link_snapshot_shape",
        "song_public_access_events_target_shape",
        "song_public_access_events_remaining_audio_nonnegative",
        "song_public_access_events_operation_shape",
        "song_public_access_events_actor_shape",
      ]),
    );
    expect(indexNames(songPublicAccessEvents)).toContain(
      "song_public_access_events_track_sequence_idx",
    );
    expect(migration).toMatch(/"changed" boolean DEFAULT false NOT NULL/);

    for (const action of [
      "link_published",
      "link_reset",
      "link_disabled",
      "audio_deleted",
      "portfolio_published",
      "portfolio_unpublished",
    ]) {
      expect(migration).toContain(`'${action}'`);
    }
    expect(migration).toMatch(
      /CREATE TRIGGER "song_public_access_events_append_only"\s+BEFORE UPDATE OR DELETE ON "song_public_access_events"\s+FOR EACH ROW EXECUTE FUNCTION "prevent_append_only_mutation"\(\)/,
    );
  });

  it("adds exact version scope and newest-live public lookup indexes", () => {
    expect(uniqueNames(trackVersions)).toContain(
      "track_versions_id_track_purchase_producer_unique",
    );
    expect(indexNames(trackVersions)).toContain("track_versions_track_live_uploaded_idx");
    expect(indexNames(projectTracks)).toContain("project_tracks_project_portfolio_published_idx");

    expect(migration).toMatch(
      /CREATE INDEX "track_versions_track_live_uploaded_idx"\s+ON "track_versions" \("track_id", "uploaded_at" DESC, "id" DESC\)\s+WHERE "audio_deleted_at" IS NULL AND "audio_url" IS NOT NULL/,
    );
    expect(migration).toMatch(
      /CREATE INDEX "project_tracks_project_portfolio_published_idx"\s+ON "project_tracks" \("project_id", "portfolio_published_at" DESC, "id"\)\s+WHERE "portfolio_published_at" IS NOT NULL/,
    );
    expect(migration).not.toMatch(/\b(?:DELETE FROM|TRUNCATE|DROP TABLE)\b/);
  });
});
