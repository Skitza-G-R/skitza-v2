import { randomUUID } from "node:crypto";

import { createDb, sql, type Db } from "@skitza/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  createPortfolioTrackFromSongVersion,
  markSongReleased,
  renameSongVersion,
  setProducerFinalVersion,
  setSongArchiveState,
  setSongLyrics,
  tombstoneStoredAudioVersion,
  updateSongMetadata,
} from "../db";
import { privateVersionStreamPath, publicPortfolioStreamPath } from "../../audio-delivery/urls";
import { songPublicationRepository } from "../../song-publication/db";
import { listPublicPortfolioSongs } from "../../song-publication/public-read";
import { setPortfolioPublic } from "../../song-publication/service";
import { computeStoredAudioIdentityFingerprint } from "../service";

// This suite never falls back to DATABASE_URL. DATABASE_URL_TEST is the
// repository's explicit opt-in for a separate disposable CI/test database.
const testDatabaseUrl = process.env.DATABASE_URL_TEST;
const describeWithTestDatabase = testDatabaseUrl ? describe : describe.skip;
const testSchema = `sk8_${randomUUID().replaceAll("-", "")}`;
const transactionApplicationNameA = `${testSchema}_a`;
const transactionApplicationNameB = `${testSchema}_b`;
const transactionApplicationNameC = `${testSchema}_c`;
const publicationTestSecret = "sk98-real-db-publication-secret-2026";

type TestTable =
  | "producers"
  | "client_contacts"
  | "projects"
  | "purchases"
  | "project_tracks"
  | "track_versions"
  | "portfolio_tracks"
  | "song_public_links"
  | "song_public_access_events";

function assertValidTestSchema(): void {
  if (!/^sk8_[a-f0-9]{32}$/.test(testSchema)) {
    throw new Error("SK-8 generated test schema is invalid");
  }
}

function qualifiedTestTable(table: TestTable): string {
  assertValidTestSchema();
  return `"${testSchema}"."${table}"`;
}

type TransactionFn = Db["transaction"];

function withIsolatedTransactionSchema(database: Db, applicationName: string): Db {
  const runTransaction = database.transaction.bind(database);
  database.transaction = (async (...args: Parameters<TransactionFn>) => {
    const [work, config] = args;
    return runTransaction(async (transaction) => {
      assertValidTestSchema();
      await transaction.execute(sql.raw(`set local search_path to "${testSchema}"`));
      await transaction.execute(
        sql`select set_config('application_name', ${applicationName}, true)`,
      );
      return work(transaction);
    }, config);
  }) as TransactionFn;
  return database;
}

type SongFixture = Readonly<{
  producerId: string;
  clientContactId: string;
  projectId: string;
  purchaseId: string;
  trackId: string;
}>;

type VersionFixture = Readonly<{
  id: string;
  audioUrl: string;
  audioR2Key: string;
  sizeBytes: number;
}>;

type DbDate = Date | string;

function timestamp(value: DbDate | null): number | null {
  return value === null ? null : new Date(value).getTime();
}

describeWithTestDatabase("SK-8 song management — separate CI test database", () => {
  const adminDb = testDatabaseUrl ? createDb(testDatabaseUrl) : null;
  // Race coverage needs distinct clients. Each operation still opens its own
  // max-one interactive transaction pool through createDb.
  const transactionDbA = testDatabaseUrl
    ? withIsolatedTransactionSchema(createDb(testDatabaseUrl), transactionApplicationNameA)
    : null;
  const transactionDbB = testDatabaseUrl
    ? withIsolatedTransactionSchema(createDb(testDatabaseUrl), transactionApplicationNameB)
    : null;
  const transactionDbC = testDatabaseUrl
    ? withIsolatedTransactionSchema(createDb(testDatabaseUrl), transactionApplicationNameC)
    : null;
  let schemaCreated = false;

  function activeAdminDb(): Db {
    if (!adminDb) throw new Error("SK-8 test database administrator is unavailable");
    return adminDb;
  }

  function activeTransactionDbA(): Db {
    if (!transactionDbA) throw new Error("SK-8 first transaction database is unavailable");
    return transactionDbA;
  }

  function activeTransactionDbB(): Db {
    if (!transactionDbB) throw new Error("SK-8 second transaction database is unavailable");
    return transactionDbB;
  }

  function activeTransactionDbC(): Db {
    if (!transactionDbC) throw new Error("SK-8 third transaction database is unavailable");
    return transactionDbC;
  }

  async function waitForDatabaseLock(
    applicationName: string,
    queryFragment: "project_tracks" | "track_versions",
  ): Promise<void> {
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      const waiting = await activeAdminDb().execute<{ waiting: boolean }>(sql`
        select exists (
          select 1
          from pg_stat_activity
          where "application_name" = ${applicationName}
            and "state" = 'active'
            and "wait_event_type" = 'Lock'
            and position(lower(${queryFragment}) in lower("query")) > 0
        ) as "waiting"
      `);
      if (waiting.rows[0]?.waiting) return;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error(`Timed out waiting for ${queryFragment} lock serialization`);
  }

  beforeAll(async () => {
    const schema = `"${testSchema}"`;
    await activeAdminDb().execute(sql.raw(`create schema ${schema}`));
    schemaCreated = true;

    const statements = [
      `create table ${schema}."producers" (
        "id" uuid primary key,
        "closed_at" timestamptz
      )`,
      `create table ${schema}."client_contacts" (
        "id" uuid primary key,
        "producer_id" uuid not null,
        "archived_at" timestamptz,
        "producer_archived_at" timestamptz
      )`,
      `create table ${schema}."projects" (
        "id" uuid primary key,
        "producer_id" uuid not null,
        "client_contact_id" uuid not null,
        "title" text not null,
        "lifecycle_status" text not null,
        "lifecycle_changed_at" timestamptz not null,
        "artist_name" text not null,
        "artist_email" text not null,
        "workflow_stage" text not null,
        "updated_at" timestamptz not null
      )`,
      `create table ${schema}."purchases" (
        "id" uuid primary key,
        "producer_id" uuid not null,
        "project_id" uuid not null,
        "client_contact_id" uuid not null
      )`,
      `create table ${schema}."project_tracks" (
        "id" uuid primary key,
        "project_id" uuid not null,
        "purchase_id" uuid not null,
        "title" text not null,
        "artist" text,
        "position" integer not null default 0,
        "workflow_stage" text not null,
        "released_at" timestamptz,
        "archived_at" timestamptz,
        "portfolio_published_at" timestamptz,
        "created_at" timestamptz not null,
        "lyrics" text,
        "lyrics_updated_at" timestamptz,
        "lyrics_updated_by" text,
        constraint "project_tracks_lyrics_stamp_shape" check (
          (
            (
              ("lyrics_updated_at" is null and "lyrics_updated_by" is null)
              or ("lyrics_updated_at" is not null and "lyrics_updated_by" is not null)
            )
            and ("lyrics" is null or "lyrics_updated_at" is not null)
            and ("lyrics" is null or char_length("lyrics") <= 8000)
          ) is true
        ),
        constraint "project_tracks_lyrics_updated_by_allowed" check (
          "lyrics_updated_by" is null or "lyrics_updated_by" in ('producer', 'artist')
        )
      )`,
      `create function ${schema}."skitza_guard_song_release_state"()
        returns trigger as $function$
        begin
          if old."released_at" is not null
            and new."released_at" is distinct from old."released_at"
          then
            raise exception 'SKITZA_SONG_RELEASE_STATE_IMMUTABLE';
          end if;
          return new;
        end;
        $function$ language plpgsql`,
      `create trigger "project_tracks_release_state_immutable"
        before update of "released_at" on ${schema}."project_tracks"
        for each row execute function ${schema}."skitza_guard_song_release_state"()`,
      `create table ${schema}."track_versions" (
        "id" uuid primary key,
        "track_id" uuid not null,
        "purchase_id" uuid not null,
        "producer_id" uuid not null,
        "label" text not null,
        "audio_url" text,
        "duration_ms" integer,
        "audio_r2_key" text,
        "size_bytes" bigint,
        "audio_object_etag" text,
        "audio_identity_fingerprint" text,
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
        "pending_audio_cleanup_etag" text,
        "peaks_r2_key" text,
        "peaks" jsonb,
        "uploaded_at" timestamptz not null,
        "producer_marked_final_at" timestamptz,
        "audio_deleted_at" timestamptz
      )`,
      `create table ${schema}."portfolio_tracks" (
        "id" uuid primary key default gen_random_uuid(),
        "producer_id" uuid not null,
        "title" text not null,
        "artist" text,
        "audio_url" text,
        "artwork_url" text,
        "position" integer not null default 0,
        "audio_r2_key" text,
        "size_bytes" bigint,
        "duration_ms" integer,
        "peaks_r2_key" text,
        "is_public_sample" boolean not null default false,
        "created_at" timestamptz not null default now()
      )`,
      `create table ${schema}."song_public_links" (
        "id" uuid primary key,
        "track_id" uuid not null unique,
        "purchase_id" uuid not null,
        "producer_id" uuid not null,
        "token_hash" text not null unique,
        "token_version" integer not null default 1,
        "enabled_at" timestamptz not null,
        "disabled_at" timestamptz,
        "created_at" timestamptz not null,
        "updated_at" timestamptz not null
      )`,
      `create table ${schema}."song_public_access_events" (
        "id" uuid primary key default gen_random_uuid(),
        "track_id" uuid not null,
        "purchase_id" uuid not null,
        "producer_id" uuid not null,
        "link_id" uuid,
        "version_id" uuid,
        "action" text not null,
        "sequence" integer not null,
        "token_version" integer,
        "token_hash" text,
        "changed" boolean not null default false,
        "link_enabled" boolean not null,
        "portfolio_published" boolean not null,
        "remaining_audio_count" integer not null,
        "operation_key" text not null,
        "operation_digest" text not null,
        "changed_by_clerk_user_id" text not null,
        "created_at" timestamptz not null default now(),
        unique ("track_id", "sequence"),
        unique ("track_id", "operation_key")
      )`,
    ];
    for (const statement of statements) {
      await activeAdminDb().execute(sql.raw(statement));
    }
  }, 30_000);

  afterAll(async () => {
    if (!schemaCreated) return;
    await activeAdminDb().execute(sql.raw(`drop schema "${testSchema}" cascade`));
  }, 30_000);

  async function createProducer(): Promise<string> {
    const producerId = randomUUID();
    await activeAdminDb().execute(sql`
      insert into ${sql.raw(qualifiedTestTable("producers"))} ("id")
      values (${producerId})
    `);
    return producerId;
  }

  function deletionAuditInput(operationKey = randomUUID()): Readonly<{
    actorClerkUserId: string;
    operationKey: string;
  }> {
    return { actorClerkUserId: "user_song_management_test", operationKey };
  }

  async function createSong(
    input: Readonly<{
      producerId?: string;
      workflowStage?: "brief" | "production" | "mixing" | "mastering" | "done";
      releasedAt?: Date | null;
      projectLifecycleStatus?: string;
      clientArchivedAt?: Date | null;
      portfolioPublishedAt?: Date | null;
      title?: string;
      artist?: string | null;
    }> = {},
  ): Promise<SongFixture> {
    const producerId = input.producerId ?? (await createProducer());
    const clientContactId = randomUUID();
    const projectId = randomUUID();
    const purchaseId = randomUUID();
    const trackId = randomUUID();
    const createdAt = new Date("2026-07-01T08:00:00.000Z");

    await activeAdminDb().execute(sql`
      insert into ${sql.raw(qualifiedTestTable("client_contacts"))}
        ("id", "producer_id", "archived_at", "producer_archived_at")
      values (
        ${clientContactId},
        ${producerId},
        ${input.clientArchivedAt ?? null},
        ${input.clientArchivedAt ?? null}
      )
    `);
    await activeAdminDb().execute(sql`
      insert into ${sql.raw(qualifiedTestTable("projects"))}
        (
          "id", "producer_id", "client_contact_id", "title", "lifecycle_status",
          "lifecycle_changed_at", "artist_name", "artist_email", "workflow_stage", "updated_at"
        )
      values (
        ${projectId}, ${producerId}, ${clientContactId}, ${"Project fixture"},
        ${input.projectLifecycleStatus ?? "active"}, ${createdAt}, ${"Fixture artist"},
        ${`artist-${randomUUID()}@example.test`}, ${"production"}, ${createdAt}
      )
    `);
    await activeAdminDb().execute(sql`
      insert into ${sql.raw(qualifiedTestTable("purchases"))}
        ("id", "producer_id", "project_id", "client_contact_id")
      values (${purchaseId}, ${producerId}, ${projectId}, ${clientContactId})
    `);
    await activeAdminDb().execute(sql`
      insert into ${sql.raw(qualifiedTestTable("project_tracks"))}
        (
          "id", "project_id", "purchase_id", "title", "artist", "workflow_stage",
          "released_at", "archived_at", "portfolio_published_at", "created_at"
        )
      values (
        ${trackId}, ${projectId}, ${purchaseId}, ${input.title ?? "Fixture song"},
        ${input.artist ?? "Fixture credit"}, ${input.workflowStage ?? "production"},
        ${input.releasedAt ?? null}, ${null}, ${input.portfolioPublishedAt ?? null}, ${createdAt}
      )
    `);

    return { producerId, clientContactId, projectId, purchaseId, trackId };
  }

  async function createStoredVersion(
    song: SongFixture,
    input: Readonly<{
      label: string;
      uploadedAt: Date;
      producerMarkedFinalAt?: Date | null;
      durationMs?: number;
      peaksR2Key?: string | null;
    }>,
  ): Promise<VersionFixture> {
    const id = randomUUID();
    const audioR2Key = `producers/${song.producerId}/tracks/${id}/test-audio.mp3`;
    const audioUrl = privateVersionStreamPath(id);
    const sizeBytes = 4_096;
    const audioObjectEtag = `etag-${id}`;
    const audioIdentityFingerprint = computeStoredAudioIdentityFingerprint({
      key: audioR2Key,
      objectEtag: audioObjectEtag,
      sizeBytes,
    });
    await activeAdminDb().execute(sql`
      insert into ${sql.raw(qualifiedTestTable("track_versions"))}
        (
          "id", "track_id", "purchase_id", "producer_id", "label", "audio_url",
          "duration_ms", "audio_r2_key", "size_bytes", "audio_object_etag",
          "audio_identity_fingerprint", "peaks_r2_key", "uploaded_at",
          "producer_marked_final_at", "audio_deleted_at"
        )
      values (
        ${id}, ${song.trackId}, ${song.purchaseId}, ${song.producerId}, ${input.label},
        ${audioUrl}, ${input.durationMs ?? 180_000}, ${audioR2Key}, ${sizeBytes},
        ${audioObjectEtag}, ${audioIdentityFingerprint}, ${input.peaksR2Key ?? null},
        ${input.uploadedAt}, ${input.producerMarkedFinalAt ?? null}, ${null}
      )
    `);
    return { id, audioUrl, audioR2Key, sizeBytes };
  }

  async function publishPortfolioCopy(song: SongFixture, version: VersionFixture): Promise<string> {
    const id = randomUUID();
    await activeAdminDb().execute(sql`
      insert into ${sql.raw(qualifiedTestTable("portfolio_tracks"))}
        (
          "id", "producer_id", "title", "artist", "audio_url", "audio_r2_key",
          "size_bytes", "duration_ms", "peaks_r2_key"
        )
      values (
        ${id}, ${song.producerId}, ${"Portfolio fixture"}, ${"Old credit"},
        ${publicPortfolioStreamPath(id)}, ${version.audioR2Key}, ${version.sizeBytes}, ${180_000},
        ${"peaks/old.json"}
      )
    `);
    return id;
  }

  async function enablePublicLink(song: SongFixture): Promise<string> {
    const id = randomUUID();
    const enabledAt = new Date("2026-07-02T08:00:00.000Z");
    await activeAdminDb().execute(sql`
      insert into ${sql.raw(qualifiedTestTable("song_public_links"))}
        (
          "id", "track_id", "purchase_id", "producer_id", "token_hash", "enabled_at",
          "disabled_at", "created_at", "updated_at"
        )
      values (
        ${id}, ${song.trackId}, ${song.purchaseId}, ${song.producerId},
        ${`sha256:${id.replaceAll("-", "").padEnd(64, "0")}`},
        ${enabledAt}, ${null}, ${enabledAt}, ${enabledAt}
      )
    `);
    return id;
  }

  it("conceals cross-producer ownership and normalizes song and version metadata", async () => {
    const song = await createSong({ title: "Old title", artist: "Old credit" });
    const strangerProducerId = await createProducer();
    const version = await createStoredVersion(song, {
      label: "Rough mix",
      uploadedAt: new Date("2026-07-03T08:00:00.000Z"),
    });
    const portfolioId = await publishPortfolioCopy(song, version);

    await expect(
      updateSongMetadata(activeTransactionDbA(), {
        producerId: strangerProducerId,
        trackId: song.trackId,
        title: "Stolen title",
        changedAt: new Date("2026-07-04T08:00:00.000Z"),
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      renameSongVersion(activeTransactionDbA(), {
        producerId: strangerProducerId,
        versionId: version.id,
        label: "Stolen version",
        changedAt: new Date("2026-07-04T08:00:00.000Z"),
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    const updated = await updateSongMetadata(activeTransactionDbA(), {
      producerId: song.producerId,
      trackId: song.trackId,
      projectId: song.projectId,
      title: "  Midnight Drive  ",
      artist: "  Maya Stone  ",
      changedAt: new Date("2026-07-05T08:00:00.000Z"),
    });
    const renamed = await renameSongVersion(activeTransactionDbA(), {
      producerId: song.producerId,
      versionId: version.id,
      projectId: song.projectId,
      label: "  Final mix  ",
      changedAt: new Date("2026-07-05T09:00:00.000Z"),
    });

    expect(updated).toMatchObject({ title: "Midnight Drive", artist: "Maya Stone" });
    expect(renamed).toEqual({ id: version.id, label: "Final mix" });
    const storedTrack = await activeAdminDb().execute<{ title: string; artist: string | null }>(sql`
      select "title", "artist"
      from ${sql.raw(qualifiedTestTable("project_tracks"))}
      where "id" = ${song.trackId}
    `);
    const storedVersion = await activeAdminDb().execute<{ label: string }>(sql`
      select "label"
      from ${sql.raw(qualifiedTestTable("track_versions"))}
      where "id" = ${version.id}
    `);
    const portfolio = await activeAdminDb().execute<{
      title: string;
      artist: string | null;
    }>(sql`
      select "title", "artist"
      from ${sql.raw(qualifiedTestTable("portfolio_tracks"))}
      where "id" = ${portfolioId}
    `);
    expect(storedTrack.rows[0]).toEqual({ title: "Midnight Drive", artist: "Maya Stone" });
    expect(storedVersion.rows[0]).toEqual({ label: "Final mix" });
    expect(portfolio.rows[0]).toEqual({ title: "Midnight Drive", artist: "Maya Stone" });
  }, 30_000);

  it("archives and restores only the song while preserving project, client, and version state", async () => {
    const clientArchivedAt = new Date("2026-06-20T08:00:00.000Z");
    const song = await createSong({
      projectLifecycleStatus: "paused",
      clientArchivedAt,
    });
    const version = await createStoredVersion(song, {
      label: "History label",
      uploadedAt: new Date("2026-07-03T08:00:00.000Z"),
      producerMarkedFinalAt: new Date("2026-07-03T09:00:00.000Z"),
    });
    const archivedAt = new Date("2026-07-06T08:00:00.000Z");

    const firstArchive = await setSongArchiveState(activeTransactionDbA(), {
      producerId: song.producerId,
      trackId: song.trackId,
      intent: "archive",
      changedAt: archivedAt,
    });
    const repeatedArchive = await setSongArchiveState(activeTransactionDbA(), {
      producerId: song.producerId,
      trackId: song.trackId,
      intent: "archive",
      changedAt: new Date("2026-07-07T08:00:00.000Z"),
    });

    expect(firstArchive.changed).toBe(true);
    expect(timestamp(firstArchive.track.archivedAt)).toBe(archivedAt.getTime());
    expect(repeatedArchive.changed).toBe(false);
    expect(timestamp(repeatedArchive.track.archivedAt)).toBe(archivedAt.getTime());

    const preserved = await activeAdminDb().execute<{
      lifecycle_status: string;
      archived_at: DbDate | null;
      producer_archived_at: DbDate | null;
      label: string;
      producer_marked_final_at: DbDate | null;
      audio_deleted_at: DbDate | null;
    }>(sql`
      select
        p."lifecycle_status",
        c."archived_at",
        c."producer_archived_at",
        v."label",
        v."producer_marked_final_at",
        v."audio_deleted_at"
      from ${sql.raw(qualifiedTestTable("projects"))} p
      inner join ${sql.raw(qualifiedTestTable("client_contacts"))} c
        on c."id" = p."client_contact_id"
      inner join ${sql.raw(qualifiedTestTable("project_tracks"))} t
        on t."project_id" = p."id"
      inner join ${sql.raw(qualifiedTestTable("track_versions"))} v
        on v."track_id" = t."id"
      where t."id" = ${song.trackId} and v."id" = ${version.id}
    `);
    expect(preserved.rows[0]).toMatchObject({
      lifecycle_status: "paused",
      label: "History label",
      audio_deleted_at: null,
    });
    expect(timestamp(preserved.rows[0]?.archived_at ?? null)).toBe(clientArchivedAt.getTime());
    expect(timestamp(preserved.rows[0]?.producer_archived_at ?? null)).toBe(
      clientArchivedAt.getTime(),
    );
    expect(timestamp(preserved.rows[0]?.producer_marked_final_at ?? null)).toBe(
      new Date("2026-07-03T09:00:00.000Z").getTime(),
    );

    const restored = await setSongArchiveState(activeTransactionDbA(), {
      producerId: song.producerId,
      trackId: song.trackId,
      intent: "restore",
      changedAt: new Date("2026-07-08T08:00:00.000Z"),
    });
    const repeatedRestore = await setSongArchiveState(activeTransactionDbA(), {
      producerId: song.producerId,
      trackId: song.trackId,
      intent: "restore",
      changedAt: new Date("2026-07-09T08:00:00.000Z"),
    });
    expect(restored).toMatchObject({ changed: true, track: { archivedAt: null } });
    expect(repeatedRestore).toMatchObject({ changed: false, track: { archivedAt: null } });
  }, 30_000);

  it("marks a song Released once and preserves the first release timestamp on retries", async () => {
    const song = await createSong({ workflowStage: "mixing" });
    const strangerProducerId = await createProducer();
    const firstReleasedAt = new Date("2026-07-09T08:00:00.000Z");
    const laterRetryAt = new Date("2026-07-10T08:00:00.000Z");

    await expect(
      markSongReleased(activeTransactionDbA(), {
        producerId: strangerProducerId,
        trackId: song.trackId,
        releasedAt: firstReleasedAt,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    const first = await markSongReleased(activeTransactionDbA(), {
      producerId: song.producerId,
      trackId: song.trackId,
      releasedAt: firstReleasedAt,
    });
    const retry = await markSongReleased(activeTransactionDbA(), {
      producerId: song.producerId,
      trackId: song.trackId,
      releasedAt: laterRetryAt,
    });

    expect(first.changed).toBe(true);
    expect(timestamp(first.releasedAt)).toBe(firstReleasedAt.getTime());
    expect(retry.changed).toBe(false);
    expect(timestamp(retry.releasedAt)).toBe(firstReleasedAt.getTime());

    const stored = await activeAdminDb().execute<{
      released_at: DbDate | null;
      workflow_stage: string;
    }>(sql`
      select "released_at", "workflow_stage"
      from ${sql.raw(qualifiedTestTable("project_tracks"))}
      where "id" = ${song.trackId}
    `);
    expect(timestamp(stored.rows[0]?.released_at ?? null)).toBe(firstReleasedAt.getTime());
    expect(stored.rows[0]?.workflow_stage).toBe("mixing");
  }, 30_000);

  it("rejects clearing or changing a song's first release timestamp in the database", async () => {
    const firstReleasedAt = new Date("2026-07-09T08:00:00.000Z");
    const song = await createSong({ releasedAt: firstReleasedAt });

    await expect(
      activeAdminDb().execute(sql`
        update ${sql.raw(qualifiedTestTable("project_tracks"))}
        set "released_at" = ${null}
        where "id" = ${song.trackId}
      `),
    ).rejects.toThrow(/SKITZA_SONG_RELEASE_STATE_IMMUTABLE/);

    await expect(
      activeAdminDb().execute(sql`
        update ${sql.raw(qualifiedTestTable("project_tracks"))}
        set "released_at" = ${new Date("2026-07-10T08:00:00.000Z")}
        where "id" = ${song.trackId}
      `),
    ).rejects.toThrow(/SKITZA_SONG_RELEASE_STATE_IMMUTABLE/);

    const stored = await activeAdminDb().execute<{ released_at: DbDate | null }>(sql`
      select "released_at"
      from ${sql.raw(qualifiedTestTable("project_tracks"))}
      where "id" = ${song.trackId}
    `);
    expect(timestamp(stored.rows[0]?.released_at ?? null)).toBe(firstReleasedAt.getTime());
  }, 30_000);

  it("serializes the one-way Released boundary with last-audio deletion", async () => {
    // Done/Delivered alone is deliberately not Released. Depending on lock
    // order, deletion either observes the committed release and succeeds or
    // observes the unreleased song and fails closed before release commits.
    const song = await createSong({ workflowStage: "done" });
    const version = await createStoredVersion(song, {
      label: "Release race master",
      uploadedAt: new Date("2026-07-03T08:00:00.000Z"),
    });
    const releasedAt = new Date("2026-07-10T08:00:00.000Z");
    const deletedAt = new Date("2026-07-10T08:00:01.000Z");

    const [release, deletion] = await Promise.allSettled([
      markSongReleased(activeTransactionDbA(), {
        producerId: song.producerId,
        trackId: song.trackId,
        releasedAt,
      }),
      tombstoneStoredAudioVersion(activeTransactionDbB(), {
        ...deletionAuditInput(),
        producerId: song.producerId,
        versionId: version.id,
        deletedAt,
      }),
    ]);

    expect(release.status).toBe("fulfilled");
    if (release.status === "fulfilled") {
      expect(release.value).toMatchObject({ changed: true });
      expect(timestamp(release.value.releasedAt)).toBe(releasedAt.getTime());
    }
    if (deletion.status === "fulfilled") {
      expect(deletion.value).toMatchObject({
        isReleased: true,
        wasLastStoredAudio: true,
      });
    } else {
      expect(deletion.reason).toMatchObject({ code: "AUDIO_PROTECTED" });
    }

    const stored = await activeAdminDb().execute<{
      released_at: DbDate | null;
      audio_deleted_at: DbDate | null;
    }>(sql`
      select t."released_at", v."audio_deleted_at"
      from ${sql.raw(qualifiedTestTable("project_tracks"))} t
      inner join ${sql.raw(qualifiedTestTable("track_versions"))} v
        on v."track_id" = t."id"
      where t."id" = ${song.trackId} and v."id" = ${version.id}
    `);
    expect(timestamp(stored.rows[0]?.released_at ?? null)).toBe(releasedAt.getTime());
    expect(stored.rows[0]?.audio_deleted_at !== null).toBe(deletion.status === "fulfilled");
  }, 30_000);

  it("publishes only a live owned version with server-owned metadata and deduplicates it", async () => {
    const song = await createSong({
      releasedAt: new Date("2026-07-09T08:00:00.000Z"),
      title: "Authoritative title",
      artist: "Authoritative credit",
    });
    const version = await createStoredVersion(song, {
      label: "Published mix",
      uploadedAt: new Date("2026-07-03T08:00:00.000Z"),
      durationMs: 172_000,
      peaksR2Key: "peaks/authoritative.json",
    });
    const strangerProducerId = await createProducer();

    await expect(
      createPortfolioTrackFromSongVersion(activeTransactionDbA(), {
        producerId: strangerProducerId,
        versionId: version.id,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    const created = await createPortfolioTrackFromSongVersion(activeTransactionDbA(), {
      producerId: song.producerId,
      versionId: version.id,
    });
    expect(created).toMatchObject({
      producerId: song.producerId,
      title: "Authoritative title",
      artist: "Authoritative credit",
      audioUrl: publicPortfolioStreamPath(created.id),
      audioR2Key: version.audioR2Key,
      sizeBytes: version.sizeBytes,
      durationMs: 172_000,
      peaksR2Key: "peaks/authoritative.json",
      isPublicSample: true,
    });
    await expect(
      createPortfolioTrackFromSongVersion(activeTransactionDbA(), {
        producerId: song.producerId,
        versionId: version.id,
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });

    await tombstoneStoredAudioVersion(activeTransactionDbA(), {
      ...deletionAuditInput(),
      producerId: song.producerId,
      versionId: version.id,
      deletedAt: new Date("2026-07-10T08:00:00.000Z"),
    });
    await expect(
      createPortfolioTrackFromSongVersion(activeTransactionDbA(), {
        producerId: song.producerId,
        versionId: version.id,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    const incompleteVersionId = randomUUID();
    await activeAdminDb().execute(sql`
      insert into ${sql.raw(qualifiedTestTable("track_versions"))}
        (
          "id", "track_id", "purchase_id", "producer_id", "label", "audio_url",
          "duration_ms", "audio_r2_key", "size_bytes", "audio_object_etag",
          "audio_identity_fingerprint", "peaks_r2_key", "uploaded_at",
          "producer_marked_final_at", "audio_deleted_at"
        )
      values (
        ${incompleteVersionId}, ${song.trackId}, ${song.purchaseId}, ${song.producerId},
        ${"Pending upload"}, ${null}, ${null}, ${null}, ${null}, ${null}, ${null},
        ${null}, ${new Date("2026-07-11T08:00:00.000Z")}, ${null}, ${null}
      )
    `);
    await expect(
      createPortfolioTrackFromSongVersion(activeTransactionDbA(), {
        producerId: song.producerId,
        versionId: incompleteVersionId,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  }, 30_000);

  it("serializes portfolio publishing with released-audio tombstoning", async () => {
    const song = await createSong({
      releasedAt: new Date("2026-07-09T08:00:00.000Z"),
      title: "Race-safe title",
      artist: "Race-safe credit",
    });
    const version = await createStoredVersion(song, {
      label: "Race mix",
      uploadedAt: new Date("2026-07-03T08:00:00.000Z"),
    });

    const [publish, deletion] = await Promise.allSettled([
      createPortfolioTrackFromSongVersion(activeTransactionDbA(), {
        producerId: song.producerId,
        versionId: version.id,
      }),
      tombstoneStoredAudioVersion(activeTransactionDbB(), {
        ...deletionAuditInput(),
        producerId: song.producerId,
        versionId: version.id,
        deletedAt: new Date("2026-07-10T08:00:00.000Z"),
      }),
    ]);

    expect(deletion.status).toBe("fulfilled");
    if (publish.status === "rejected") {
      expect(publish.reason).toMatchObject({ code: "NOT_FOUND" });
    }
    const exposed = await activeAdminDb().execute<{ id: string }>(sql`
      select "id"
      from ${sql.raw(qualifiedTestTable("portfolio_tracks"))}
      where "producer_id" = ${song.producerId}
        and ("audio_r2_key" = ${version.audioR2Key} or "audio_url" = ${version.audioUrl})
    `);
    const storedVersion = await activeAdminDb().execute<{
      audio_deleted_at: DbDate | null;
    }>(sql`
      select "audio_deleted_at"
      from ${sql.raw(qualifiedTestTable("track_versions"))}
      where "id" = ${version.id}
    `);
    expect(exposed.rows).toHaveLength(0);
    expect(storedVersion.rows[0]?.audio_deleted_at).not.toBeNull();
  }, 30_000);

  it("protects current, producer-final, and last stored audio before release", async () => {
    const song = await createSong({ workflowStage: "mastering" });
    const oldest = await createStoredVersion(song, {
      label: "V1",
      uploadedAt: new Date("2026-07-01T08:00:00.000Z"),
    });
    const producerFinal = await createStoredVersion(song, {
      label: "V2",
      uploadedAt: new Date("2026-07-02T08:00:00.000Z"),
      producerMarkedFinalAt: new Date("2026-07-02T09:00:00.000Z"),
    });
    const current = await createStoredVersion(song, {
      label: "V3",
      uploadedAt: new Date("2026-07-03T08:00:00.000Z"),
    });
    const onlySong = await createSong({ workflowStage: "brief" });
    const only = await createStoredVersion(onlySong, {
      label: "Only",
      uploadedAt: new Date("2026-07-03T08:00:00.000Z"),
    });

    await expect(
      tombstoneStoredAudioVersion(activeTransactionDbA(), {
        ...deletionAuditInput(),
        producerId: song.producerId,
        versionId: current.id,
        deletedAt: new Date("2026-07-10T08:00:00.000Z"),
      }),
    ).rejects.toMatchObject({ code: "AUDIO_PROTECTED" });
    await expect(
      tombstoneStoredAudioVersion(activeTransactionDbA(), {
        ...deletionAuditInput(),
        producerId: song.producerId,
        versionId: producerFinal.id,
        deletedAt: new Date("2026-07-10T08:00:00.000Z"),
      }),
    ).rejects.toMatchObject({ code: "AUDIO_PROTECTED" });
    await expect(
      tombstoneStoredAudioVersion(activeTransactionDbA(), {
        ...deletionAuditInput(),
        producerId: onlySong.producerId,
        versionId: only.id,
        deletedAt: new Date("2026-07-10T08:00:00.000Z"),
      }),
    ).rejects.toMatchObject({ code: "AUDIO_PROTECTED" });

    const untouched = await activeAdminDb().execute<{ id: string }>(sql`
      select "id"
      from ${sql.raw(qualifiedTestTable("track_versions"))}
      where "id" in (${oldest.id}, ${producerFinal.id}, ${current.id}, ${only.id})
        and "audio_deleted_at" is null
    `);
    expect(untouched.rows).toHaveLength(4);
  }, 30_000);

  it("retargets released playback, retries idempotently, then removes the last public audio", async () => {
    const publishedAt = new Date("2026-07-03T07:00:00.000Z");
    const song = await createSong({
      releasedAt: new Date("2026-07-10T08:00:00.000Z"),
      portfolioPublishedAt: publishedAt,
      title: "Released song",
      artist: "Released artist",
    });
    const older = await createStoredVersion(song, {
      label: "V1",
      uploadedAt: new Date("2026-07-03T08:00:00.000Z"),
      durationMs: 175_000,
      peaksR2Key: "peaks/older.json",
    });
    const newer = await createStoredVersion(song, {
      label: "Final",
      uploadedAt: new Date("2026-07-04T08:00:00.000Z"),
      producerMarkedFinalAt: new Date("2026-07-04T09:00:00.000Z"),
      durationMs: 181_000,
      peaksR2Key: "peaks/newer.json",
    });
    const portfolioId = await publishPortfolioCopy(song, newer);
    const publicLinkId = await enablePublicLink(song);
    const firstDeletedAt = new Date("2026-07-11T08:00:00.000Z");
    const firstDeleteOperationKey = randomUUID();

    const first = await tombstoneStoredAudioVersion(activeTransactionDbA(), {
      ...deletionAuditInput(firstDeleteOperationKey),
      producerId: song.producerId,
      versionId: newer.id,
      deletedAt: firstDeletedAt,
    });
    expect(first).toMatchObject({
      alreadyTombstoned: false,
      isReleased: true,
      wasCurrent: true,
      wasProducerFinal: true,
      wasLastStoredAudio: false,
      nextPlaybackVersionId: older.id,
    });

    const retargeted = await activeAdminDb().execute<{
      title: string;
      artist: string | null;
      audio_url: string | null;
      audio_r2_key: string | null;
      size_bytes: number | string | null;
      duration_ms: number | null;
      peaks_r2_key: string | null;
    }>(sql`
      select
        "title", "artist", "audio_url", "audio_r2_key", "size_bytes", "duration_ms",
        "peaks_r2_key"
      from ${sql.raw(qualifiedTestTable("portfolio_tracks"))}
      where "producer_id" = ${song.producerId}
    `);
    expect(retargeted.rows[0]).toMatchObject({
      title: "Released song",
      artist: "Released artist",
      audio_url: publicPortfolioStreamPath(portfolioId),
      audio_r2_key: older.audioR2Key,
      duration_ms: 175_000,
      peaks_r2_key: "peaks/older.json",
    });
    expect(Number(retargeted.rows[0]?.size_bytes)).toBe(older.sizeBytes);
    const activeLink = await activeAdminDb().execute<{ disabled_at: DbDate | null }>(sql`
      select "disabled_at"
      from ${sql.raw(qualifiedTestTable("song_public_links"))}
      where "track_id" = ${song.trackId}
    `);
    expect(activeLink.rows[0]?.disabled_at).toBeNull();

    await expect(
      tombstoneStoredAudioVersion(activeTransactionDbA(), {
        ...deletionAuditInput(firstDeleteOperationKey),
        producerId: song.producerId,
        versionId: older.id,
        deletedAt: new Date("2026-07-11T09:00:00.000Z"),
      }),
    ).rejects.toMatchObject({ code: "OPERATION_KEY_CONFLICT" });

    const retry = await tombstoneStoredAudioVersion(activeTransactionDbA(), {
      ...deletionAuditInput(firstDeleteOperationKey),
      producerId: song.producerId,
      versionId: newer.id,
      deletedAt: new Date("2026-07-12T08:00:00.000Z"),
    });
    expect(retry).toMatchObject({
      alreadyTombstoned: true,
      isReleased: true,
      nextPlaybackVersionId: older.id,
    });
    const retainedFirstTimestamp = await activeAdminDb().execute<{
      audio_deleted_at: DbDate | null;
    }>(sql`
      select "audio_deleted_at"
      from ${sql.raw(qualifiedTestTable("track_versions"))}
      where "id" = ${newer.id}
    `);
    expect(timestamp(retainedFirstTimestamp.rows[0]?.audio_deleted_at ?? null)).toBe(
      firstDeletedAt.getTime(),
    );

    const lastDeletedAt = new Date("2026-07-13T08:00:00.000Z");
    const last = await tombstoneStoredAudioVersion(activeTransactionDbA(), {
      ...deletionAuditInput(),
      producerId: song.producerId,
      versionId: older.id,
      deletedAt: lastDeletedAt,
    });
    expect(last).toMatchObject({
      alreadyTombstoned: false,
      isReleased: true,
      wasCurrent: true,
      wasLastStoredAudio: true,
      nextPlaybackVersionId: null,
    });

    const portfolioRows = await activeAdminDb().execute<{ id: string }>(sql`
      select "id"
      from ${sql.raw(qualifiedTestTable("portfolio_tracks"))}
      where "producer_id" = ${song.producerId}
    `);
    const historyRows = await activeAdminDb().execute<{
      id: string;
      audio_url: string | null;
      audio_r2_key: string | null;
      audio_deleted_at: DbDate | null;
    }>(sql`
      select "id", "audio_url", "audio_r2_key", "audio_deleted_at"
      from ${sql.raw(qualifiedTestTable("track_versions"))}
      where "track_id" = ${song.trackId}
      order by "uploaded_at"
    `);
    const disabled = await activeAdminDb().execute<{
      disabled_at: DbDate | null;
      portfolio_published_at: DbDate | null;
    }>(sql`
      select l."disabled_at", t."portfolio_published_at"
      from ${sql.raw(qualifiedTestTable("song_public_links"))} l
      inner join ${sql.raw(qualifiedTestTable("project_tracks"))} t
        on t."id" = l."track_id"
      where l."track_id" = ${song.trackId}
    `);
    expect(portfolioRows.rows).toHaveLength(0);
    expect(historyRows.rows).toHaveLength(2);
    expect(
      historyRows.rows.every(
        (row) =>
          row.audio_url !== null && row.audio_r2_key !== null && row.audio_deleted_at !== null,
      ),
    ).toBe(true);
    expect(timestamp(disabled.rows[0]?.disabled_at ?? null)).toBe(lastDeletedAt.getTime());
    expect(disabled.rows[0]?.portfolio_published_at).toBeNull();

    const auditEvents = await activeAdminDb().execute<{
      sequence: number;
      link_id: string | null;
      version_id: string | null;
      action: string;
      token_version: number | null;
      token_hash: string | null;
      changed: boolean;
      link_enabled: boolean;
      portfolio_published: boolean;
      remaining_audio_count: number;
      operation_digest: string;
    }>(sql`
      select
        "sequence", "link_id", "version_id", "action", "token_version", "token_hash",
        "changed", "link_enabled", "portfolio_published", "remaining_audio_count",
        "operation_digest"
      from ${sql.raw(qualifiedTestTable("song_public_access_events"))}
      where "track_id" = ${song.trackId}
      order by "sequence"
    `);
    expect(auditEvents.rows).toHaveLength(2);
    expect(auditEvents.rows[0]).toMatchObject({
      sequence: 1,
      link_id: publicLinkId,
      version_id: newer.id,
      action: "audio_deleted",
      token_version: 1,
      changed: true,
      link_enabled: true,
      portfolio_published: true,
      remaining_audio_count: 1,
    });
    expect(auditEvents.rows[1]).toMatchObject({
      sequence: 2,
      link_id: publicLinkId,
      version_id: older.id,
      action: "audio_deleted",
      token_version: 1,
      changed: true,
      link_enabled: false,
      portfolio_published: false,
      remaining_audio_count: 0,
    });
    expect(auditEvents.rows[0]?.token_hash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(auditEvents.rows[0]?.operation_digest).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(auditEvents.rows[1]?.operation_digest).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(auditEvents.rows[1]?.operation_digest).not.toBe(auditEvents.rows[0]?.operation_digest);
  }, 30_000);

  it("disables public surfaces when only a noncanonical completed row remains", async () => {
    const song = await createSong({
      releasedAt: new Date("2026-07-10T08:00:00.000Z"),
      portfolioPublishedAt: new Date("2026-07-10T08:01:00.000Z"),
    });
    const canonical = await createStoredVersion(song, {
      label: "Deliverable",
      uploadedAt: new Date("2026-07-11T08:00:00.000Z"),
    });
    const noncanonical = await createStoredVersion(song, {
      label: "Corrupt completed row",
      uploadedAt: new Date("2026-07-12T08:00:00.000Z"),
    });
    await activeAdminDb().execute(sql`
      update ${sql.raw(qualifiedTestTable("track_versions"))}
      set "audio_url" = ${privateVersionStreamPath(canonical.id)}
      where "id" = ${noncanonical.id}
    `);
    await enablePublicLink(song);

    const deletedAt = new Date("2026-07-13T08:00:00.000Z");
    const deleted = await tombstoneStoredAudioVersion(activeTransactionDbA(), {
      ...deletionAuditInput(),
      producerId: song.producerId,
      versionId: canonical.id,
      deletedAt,
    });

    expect(deleted).toMatchObject({
      wasLastStoredAudio: true,
      nextPlaybackVersionId: null,
    });
    const lifecycle = await activeAdminDb().execute<{
      disabled_at: DbDate | null;
      portfolio_published_at: DbDate | null;
      remaining_audio_count: number;
      link_enabled: boolean;
      portfolio_published: boolean;
    }>(sql`
      select
        l."disabled_at", t."portfolio_published_at", e."remaining_audio_count",
        e."link_enabled", e."portfolio_published"
      from ${sql.raw(qualifiedTestTable("song_public_links"))} l
      inner join ${sql.raw(qualifiedTestTable("project_tracks"))} t
        on t."id" = l."track_id"
      inner join ${sql.raw(qualifiedTestTable("song_public_access_events"))} e
        on e."track_id" = t."id"
      where t."id" = ${song.trackId} and e."version_id" = ${canonical.id}
    `);
    expect(timestamp(lifecycle.rows[0]?.disabled_at ?? null)).toBe(deletedAt.getTime());
    expect(lifecycle.rows[0]).toMatchObject({
      portfolio_published_at: null,
      remaining_audio_count: 0,
      link_enabled: false,
      portfolio_published: false,
    });
  }, 30_000);

  it("serializes final selection against stored-audio deletion", async () => {
    const song = await createSong({ workflowStage: "mixing" });
    const target = await createStoredVersion(song, {
      label: "Older candidate",
      uploadedAt: new Date("2026-07-01T08:00:00.000Z"),
    });
    await createStoredVersion(song, {
      label: "Current",
      uploadedAt: new Date("2026-07-02T08:00:00.000Z"),
    });

    const outcomes = await Promise.allSettled([
      tombstoneStoredAudioVersion(activeTransactionDbA(), {
        ...deletionAuditInput(),
        producerId: song.producerId,
        versionId: target.id,
        deletedAt: new Date("2026-07-14T08:00:00.000Z"),
      }),
      setProducerFinalVersion(activeTransactionDbB(), {
        producerId: song.producerId,
        versionId: target.id,
        markedFinal: true,
        changedAt: new Date("2026-07-14T08:00:00.000Z"),
      }),
    ]);

    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.status === "rejected")).toHaveLength(1);
    const stored = await activeAdminDb().execute<{
      audio_deleted_at: DbDate | null;
      producer_marked_final_at: DbDate | null;
    }>(sql`
      select "audio_deleted_at", "producer_marked_final_at"
      from ${sql.raw(qualifiedTestTable("track_versions"))}
      where "id" = ${target.id}
    `);
    const row = stored.rows[0];
    if (!row) throw new Error("The raced version disappeared from history");
    expect(
      (row.audio_deleted_at !== null && row.producer_marked_final_at === null) ||
        (row.audio_deleted_at === null && row.producer_marked_final_at !== null),
    ).toBe(true);
  }, 30_000);

  it("serializes a public portfolio listing against producer unpublish", async () => {
    const publishedAt = new Date("2026-07-15T08:00:00.000Z");
    const song = await createSong({
      portfolioPublishedAt: publishedAt,
      title: "Public until the writer commits",
      artist: "Race-safe artist",
    });
    const version = await createStoredVersion(song, {
      label: "Current public mix",
      uploadedAt: new Date("2026-07-15T09:00:00.000Z"),
    });

    let signalBlockerReady!: () => void;
    let releaseVersionTable!: () => void;
    const blockerReady = new Promise<void>((resolve) => {
      signalBlockerReady = resolve;
    });
    const versionTableRelease = new Promise<void>((resolve) => {
      releaseVersionTable = resolve;
    });
    const versionTableBlocker = activeTransactionDbB().transaction(async (tx) => {
      await tx.execute(
        sql.raw(`lock table ${qualifiedTestTable("track_versions")} in access exclusive mode`),
      );
      signalBlockerReady();
      await versionTableRelease;
    });
    await blockerReady;

    const completionOrder: string[] = [];
    const listing = listPublicPortfolioSongs(activeTransactionDbA(), {
      producerId: song.producerId,
      secret: publicationTestSecret,
      limit: 3,
    }).then((songs) => {
      completionOrder.push("listing");
      return songs;
    });
    await waitForDatabaseLock(transactionApplicationNameA, "track_versions");

    const unpublish = setPortfolioPublic(
      songPublicationRepository(activeTransactionDbC()),
      {
        producerId: song.producerId,
        trackId: song.trackId,
        operationKey: randomUUID(),
        changedByClerkUserId: "user_portfolio_race_test",
        occurredAt: new Date("2026-07-16T08:00:00.000Z"),
        published: false,
      },
      { tokenSecret: publicationTestSecret },
    ).then((result) => {
      completionOrder.push("unpublish");
      return result;
    });

    try {
      await waitForDatabaseLock(transactionApplicationNameC, "project_tracks");
    } finally {
      releaseVersionTable();
      await versionTableBlocker;
    }

    const [songs, unpublished] = await Promise.all([listing, unpublish]);
    expect(completionOrder).toEqual(["listing", "unpublish"]);
    expect(songs).toHaveLength(1);
    expect(songs[0]).toMatchObject({
      id: song.trackId,
      title: "Public until the writer commits",
      artist: "Race-safe artist",
      portfolioPublishedAt: publishedAt,
    });
    expect(songs[0]?.audioUrl).toContain(version.id);
    expect(unpublished.state.portfolioPublished).toBe(false);

    const stored = await activeAdminDb().execute<{ portfolio_published_at: DbDate | null }>(sql`
      select "portfolio_published_at"
      from ${sql.raw(qualifiedTestTable("project_tracks"))}
      where "id" = ${song.trackId}
    `);
    expect(stored.rows[0]?.portfolio_published_at).toBeNull();
  }, 30_000);
  it("saves a lyrics sheet, then refuses a save that started from a stale one", async () => {
    const song = await createSong();

    const first = await setSongLyrics(activeTransactionDbA(), {
      producerId: song.producerId,
      trackId: song.trackId,
      projectId: song.projectId,
      lyrics: "  אין פה ציפייה לנצח\r\nזה משהו שרציתי  ",
      expectedUpdatedAt: null,
      updatedBy: "producer",
      changedAt: new Date("2026-09-04T10:00:00.000Z"),
    });
    expect(first.ok).toBe(true);
    if (!first.ok) throw new Error("expected the first save to win");
    expect(first.lyrics).toBe("אין פה ציפייה לנצח\nזה משהו שרציתי");
    expect(first.lyricsUpdatedBy).toBe("producer");

    // The artist opened the popup before the producer saved, so they still
    // hold the original null stamp. Their save must not replace the sheet.
    const stale = await setSongLyrics(activeTransactionDbA(), {
      producerId: song.producerId,
      trackId: song.trackId,
      projectId: song.projectId,
      lyrics: "totally different words",
      expectedUpdatedAt: null,
      updatedBy: "artist",
      changedAt: new Date("2026-09-04T10:01:00.000Z"),
    });
    expect(stale.ok).toBe(false);
    if (stale.ok) throw new Error("expected the stale save to be refused");
    expect(stale.reason).toBe("stale");
    expect(stale.lyrics).toBe("אין פה ציפייה לנצח\nזה משהו שרציתי");
    expect(stale.lyricsUpdatedBy).toBe("producer");

    const untouched = await activeAdminDb().execute<{ lyrics: string | null }>(sql`
      select "lyrics"
      from ${sql.raw(qualifiedTestTable("project_tracks"))}
      where "id" = ${song.trackId}
    `);
    expect(untouched.rows[0]?.lyrics).toBe("אין פה ציפייה לנצח\nזה משהו שרציתי");

    // Re-sending with the stamp the refusal handed back is "save mine anyway".
    const retry = await setSongLyrics(activeTransactionDbA(), {
      producerId: song.producerId,
      trackId: song.trackId,
      projectId: song.projectId,
      lyrics: "totally different words",
      expectedUpdatedAt: stale.lyricsUpdatedAt,
      updatedBy: "artist",
      changedAt: new Date("2026-09-04T10:02:00.000Z"),
    });
    expect(retry.ok).toBe(true);
    if (!retry.ok) throw new Error("expected the override to win");
    expect(retry.lyrics).toBe("totally different words");
    expect(retry.lyricsUpdatedBy).toBe("artist");
  }, 30_000);

  it("clearing the sheet keeps the stamps so we still know who emptied it", async () => {
    const song = await createSong();
    const written = await setSongLyrics(activeTransactionDbA(), {
      producerId: song.producerId,
      trackId: song.trackId,
      lyrics: "words",
      expectedUpdatedAt: null,
      updatedBy: "producer",
      changedAt: new Date("2026-09-04T11:00:00.000Z"),
    });
    if (!written.ok) throw new Error("expected the write to win");

    const cleared = await setSongLyrics(activeTransactionDbA(), {
      producerId: song.producerId,
      trackId: song.trackId,
      lyrics: "   \n  ",
      expectedUpdatedAt: written.lyricsUpdatedAt,
      updatedBy: "artist",
      changedAt: new Date("2026-09-04T11:01:00.000Z"),
    });
    expect(cleared.ok).toBe(true);
    if (!cleared.ok) throw new Error("expected the clear to win");
    expect(cleared.lyrics).toBeNull();
    expect(cleared.lyricsUpdatedBy).toBe("artist");

    const stored = await activeAdminDb().execute<{
      lyrics: string | null;
      lyrics_updated_by: string | null;
    }>(sql`
      select "lyrics", "lyrics_updated_by"
      from ${sql.raw(qualifiedTestTable("project_tracks"))}
      where "id" = ${song.trackId}
    `);
    expect(stored.rows[0]?.lyrics).toBeNull();
    expect(stored.rows[0]?.lyrics_updated_by).toBe("artist");
  }, 30_000);

  it("never lets another producer read or replace a song's lyrics", async () => {
    const song = await createSong();
    const strangerProducerId = await createProducer();
    await setSongLyrics(activeTransactionDbA(), {
      producerId: song.producerId,
      trackId: song.trackId,
      lyrics: "mine",
      expectedUpdatedAt: null,
      updatedBy: "producer",
      changedAt: new Date("2026-09-04T12:00:00.000Z"),
    });

    await expect(
      setSongLyrics(activeTransactionDbA(), {
        producerId: strangerProducerId,
        trackId: song.trackId,
        lyrics: "stolen",
        expectedUpdatedAt: null,
        updatedBy: "producer",
        changedAt: new Date("2026-09-04T12:01:00.000Z"),
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    const stored = await activeAdminDb().execute<{ lyrics: string | null }>(sql`
      select "lyrics"
      from ${sql.raw(qualifiedTestTable("project_tracks"))}
      where "id" = ${song.trackId}
    `);
    expect(stored.rows[0]?.lyrics).toBe("mine");
  }, 30_000);

  it("refuses a sheet past the cap instead of storing a truncated song", async () => {
    const song = await createSong();
    await expect(
      setSongLyrics(activeTransactionDbA(), {
        producerId: song.producerId,
        trackId: song.trackId,
        lyrics: "x".repeat(8001),
        expectedUpdatedAt: null,
        updatedBy: "producer",
        changedAt: new Date("2026-09-04T13:00:00.000Z"),
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });

    const stored = await activeAdminDb().execute<{ lyrics: string | null }>(sql`
      select "lyrics"
      from ${sql.raw(qualifiedTestTable("project_tracks"))}
      where "id" = ${song.trackId}
    `);
    expect(stored.rows[0]?.lyrics).toBeNull();
  }, 30_000);
});
