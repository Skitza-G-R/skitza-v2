import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const { createDbForRouter } = vi.hoisted(() => ({
  createDbForRouter: vi.fn(),
}));

vi.mock("@skitza/db", async () => {
  const actual = await vi.importActual<typeof import("@skitza/db")>("@skitza/db");
  return { ...actual, createDb: createDbForRouter };
});

import { sql, type Db } from "@skitza/db";

import { bookingRouter } from "../booking";
import { clientContactsRouter } from "../client-contacts";

const testDatabaseUrl = process.env.DATABASE_URL_TEST;
const runningInCi = process.env.CI !== undefined && process.env.CI !== "false";
if (runningInCi && !testDatabaseUrl) {
  throw new Error("SK-145 CI requires DATABASE_URL_TEST; these DB cases must run, not skip");
}
const describeWithTestDatabase = testDatabaseUrl ? describe : describe.skip;
const testSchema = `sk145_${randomUUID().replaceAll("-", "")}`;
const rollbackMarker = "SK-145 intentional test transaction rollback";

const producerId = randomUUID();
const producerUserId = `sk145-producer-${randomUUID()}`;
const clientId = randomUUID();
const projectId = randomUUID();
const purchaseId = randomUUID();
const bookingId = randomUUID();
const allowanceId = randomUUID();
const otherOwnedProjectId = randomUUID();
const otherOwnedPurchaseId = randomUUID();
const otherOwnedBookingId = randomUUID();
const otherOwnedAllowanceId = randomUUID();
const otherOwnedClientId = randomUUID();
const pendingOwnedBookingId = randomUUID();
const pendingOwnedAllowanceId = randomUUID();
const trackId = randomUUID();
const versionId = randomUUID();
const commentId = randomUUID();

const foreignProducerId = randomUUID();
const foreignProducerUserId = `sk145-foreign-producer-${randomUUID()}`;
const foreignClientId = randomUUID();
const foreignProjectId = randomUUID();
const foreignPurchaseId = randomUUID();
const foreignBookingId = randomUUID();
const foreignAllowanceId = randomUUID();
const foreignTrackId = randomUUID();
const foreignVersionId = randomUUID();
const foreignCommentId = randomUUID();

function assertValidTestSchema(): void {
  if (!/^sk145_[a-f0-9]{32}$/.test(testSchema)) {
    throw new Error("SK-145 generated test schema is invalid");
  }
}

describeWithTestDatabase("SK-145 route reads — isolated disposable Postgres", () => {
  let isolatedDb: Db | null = null;
  let releaseTransaction: (() => void) | null = null;
  let transactionFinished: Promise<void> | null = null;
  let previousDatabaseUrl: string | undefined;

  function activeDb(): Db {
    if (!isolatedDb) throw new Error("SK-145 isolated database is unavailable");
    return isolatedDb;
  }

  beforeAll(async () => {
    if (!testDatabaseUrl) {
      throw new Error("SK-145 requires DATABASE_URL_TEST");
    }
    assertValidTestSchema();
    previousDatabaseUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = "postgresql://sk145.invalid/guard";

    const actualDb = await vi.importActual<typeof import("@skitza/db")>("@skitza/db");
    let resolveReady!: (db: Db) => void;
    let rejectReady!: (error: unknown) => void;
    const ready = new Promise<Db>((resolve, reject) => {
      resolveReady = resolve;
      rejectReady = reject;
    });
    const hold = new Promise<void>((resolve) => {
      releaseTransaction = resolve;
    });

    const run = actualDb.createDb(testDatabaseUrl).transaction(async (tx) => {
      try {
        await tx.execute(actualDb.sql.raw(`create schema "${testSchema}"`));
        await tx.execute(actualDb.sql.raw(`set local search_path to "${testSchema}"`));

        const statements = [
          `create table "producers" (
            "id" uuid primary key,
            "clerk_user_id" text not null unique,
            "closed_at" timestamptz
          )`,
          `create table "client_contacts" (
            "id" uuid primary key,
            "producer_id" uuid not null,
            "email_hash" text not null,
            "email" text not null,
            "name" text not null,
            "first_seen_at" timestamptz not null,
            "last_seen_at" timestamptz not null,
            "tags" text[] not null default '{}',
            "notes" text,
            "phone" text,
            "referral_source" text,
            "clerk_user_id" text,
            "archived_at" timestamptz,
            "producer_archived_at" timestamptz,
            "invited_at" timestamptz,
            "position" integer not null default 0
          )`,
          `create table "projects" (
            "id" uuid primary key,
            "producer_id" uuid not null,
            "client_contact_id" uuid not null,
            "title" text not null,
            "lifecycle_status" text not null,
            "lifecycle_changed_at" timestamptz not null,
            "client_name" text,
            "client_email" text,
            "artist_name" text not null,
            "artist_email" text not null,
            "invite_token" text,
            "created_at" timestamptz not null,
            "updated_at" timestamptz not null,
            "testimonial_requested_at" timestamptz,
            "notes" text,
            "position" integer not null default 0,
            "workflow_stage" text not null,
            "deadline_at" timestamptz
          )`,
          `create table "purchases" (
            "id" uuid primary key,
            "producer_id" uuid not null,
            "project_id" uuid not null,
            "commercial_snapshot" jsonb not null
          )`,
          // Mirrors migration 0054: the durable email-only invitation outbox
          // that workspace reads join for current-email invitation truth.
          `create table "client_invitation_email_deliveries" (
            "id" uuid primary key default gen_random_uuid(),
            "client_contact_id" uuid not null,
            "producer_id" uuid not null,
            "operation_key" text not null,
            "operation_digest" text not null,
            "recipient_email" text not null,
            "recipient_email_hash" text not null,
            "message_snapshot" jsonb not null,
            "requested_by_clerk_user_id" text not null,
            "provider_idempotency_key" text not null,
            "status" text not null default 'reserved',
            "claim_token" text,
            "claim_until" timestamptz,
            "attempt_count" integer not null default 0,
            "first_attempt_at" timestamptz,
            "last_attempt_at" timestamptz,
            "provider_dedupe_expires_at" timestamptz,
            "provider_message_id" text,
            "provider_accepted_at" timestamptz,
            "last_failed_at" timestamptz,
            "failure_code" text,
            "created_at" timestamptz not null default now(),
            "updated_at" timestamptz not null default now(),
            constraint "client_invitation_email_deliveries_operation_unique"
              unique ("producer_id", "client_contact_id", "operation_key")
          )`,
          `create table "bookings" (
            "id" uuid primary key,
            "producer_id" uuid not null,
            "project_id" uuid not null,
            "purchase_id" uuid not null,
            "session_allowance_id" uuid not null,
            "song_id" uuid,
            "artist_name" text not null,
            "artist_email" text not null,
            "artist_phone" text,
            "notes" text,
            "title" text,
            "origin" text not null default 'legacy',
            "billing_treatment" text not null default 'included',
            "starts_at" timestamptz not null,
            "duration_min" integer not null,
            "operation_key" text not null,
            "operation_digest" text not null,
            "rescheduled_from_booking_id" uuid,
            "allowance_use_id" uuid not null default gen_random_uuid(),
            "cancellation_policy_hours_snapshot" integer not null default 24,
            "cancellation_policy_snapshotted_at" timestamptz not null default now(),
            "cancellation_policy_backfilled" boolean not null default false,
            "held_expires_at" timestamptz,
            "held_expired_at" timestamptz,
            "held_expiry_reason" text,
            "status" text not null,
            "status_changed_at" timestamptz,
            "outcome" text not null,
            "outcome_changed_at" timestamptz,
            "calendar_revision" integer not null default 0,
            "artist_rsvp_status" text,
            "artist_rsvp_responded_at" timestamptz,
            "reminder_sent_24h" timestamptz,
            "reminder_sent_1h" timestamptz,
            "created_at" timestamptz not null,
            "updated_at" timestamptz not null default now()
          )`,
          `create table "booking_change_requests" (
            "id" uuid primary key,
            "booking_id" uuid not null,
            "producer_id" uuid not null,
            "kind" text not null,
            "proposed_starts_at" timestamptz,
            "requested_at" timestamptz not null,
            "status" text not null
          )`,
          `create table "project_tracks" (
            "id" uuid primary key,
            "project_id" uuid not null,
            "purchase_id" uuid not null
          )`,
          `create table "track_versions" (
            "id" uuid primary key,
            "track_id" uuid not null
          )`,
          `create table "track_comments" (
            "id" uuid primary key,
            "version_id" uuid not null,
            "body" text not null,
            "timestamp_ms" integer not null,
            "resolved_at" timestamptz,
            "from_producer" boolean not null,
            "created_at" timestamptz not null
          )`,
          `create table "purchase_requests" (
            "producer_id" uuid not null,
            "project_id" uuid
          )`,
          `create table "private_offers" (
            "producer_id" uuid not null,
            "target_project_id" uuid
          )`,
          `create table "notifications" (
            "producer_id" uuid not null,
            "project_id" uuid
          )`,
        ];
        for (const statement of statements) {
          await tx.execute(actualDb.sql.raw(statement));
        }

        await tx.execute(sql`
          insert into "producers" ("id", "clerk_user_id")
          values
            (${producerId}, ${producerUserId}),
            (${foreignProducerId}, ${foreignProducerUserId})
        `);
        await tx.execute(sql`
          insert into "client_contacts" (
            "id", "producer_id", "email_hash", "email", "name",
            "first_seen_at", "last_seen_at", "tags", "phone",
            "clerk_user_id", "invited_at", "position"
          )
          values
            (
              ${clientId}, ${producerId}, ${"a".repeat(64)}, 'owned@example.test',
              'Owned Artist', '2026-07-01T08:00:00Z', '2026-07-25T08:00:00Z',
              array['owned'], '+972500000145', 'artist_owned',
              '2026-07-02T08:00:00Z', 0
            ),
            (
              ${otherOwnedClientId}, ${producerId}, ${"c".repeat(64)},
              'other-owned@example.test', 'Other Owned Artist',
              '2026-07-02T08:00:00Z', '2026-07-24T08:00:00Z',
              array['other-owned'], '+972500000146', 'artist_other_owned',
              '2026-07-03T08:00:00Z', 1
            ),
            (
              ${foreignClientId}, ${foreignProducerId}, ${"b".repeat(64)},
              'foreign@example.test', 'Foreign Artist', '2026-07-01T08:00:00Z',
              '2026-07-26T08:00:00Z', array['foreign'], null, 'artist_foreign',
              '2026-07-02T08:00:00Z', 0
            )
        `);
        await tx.execute(sql`
          insert into "projects" (
            "id", "producer_id", "client_contact_id", "title", "lifecycle_status",
            "lifecycle_changed_at", "client_name", "client_email", "artist_name",
            "artist_email", "created_at", "updated_at", "position", "workflow_stage",
            "deadline_at"
          )
          values
            (
              ${projectId}, ${producerId}, ${clientId}, 'Owned Project', 'active',
              '2026-07-03T08:00:00Z', 'Owned Artist', 'owned@example.test',
              'Owned Artist', 'owned@example.test', '2026-07-03T08:00:00Z',
              '2026-07-25T09:00:00Z', 0, 'production', '2026-08-20T08:00:00Z'
            ),
            (
              ${otherOwnedProjectId}, ${producerId}, ${otherOwnedClientId},
              'Other Owned Project', 'active', '2026-07-04T08:00:00Z',
              'Other Owned Artist', 'other-owned@example.test', 'Other Owned Artist',
              'other-owned@example.test',
              '2026-07-04T08:00:00Z', '2026-07-24T09:00:00Z', 1, 'brief', null
            ),
            (
              ${foreignProjectId}, ${foreignProducerId}, ${foreignClientId},
              'Foreign Project', 'active', '2026-07-03T08:00:00Z',
              'Foreign Artist', 'foreign@example.test', 'Foreign Artist',
              'foreign@example.test', '2026-07-03T08:00:00Z',
              '2026-07-26T09:00:00Z', 0, 'mixing', null
            )
        `);

        // Provider-accepted evidence for one owned Client and one foreign
        // Client: workspace reads must surface only the owned row's evidence.
        const inviteMessage = JSON.stringify({
          to: "owned@example.test",
          artistName: "Owned Artist",
          producerName: "Producer",
          inviteUrl: "https://skitza.app/sign-up/join/producer/home",
        });
        await tx.execute(sql`
          insert into "client_invitation_email_deliveries" (
            "client_contact_id", "producer_id", "operation_key", "operation_digest",
            "recipient_email", "recipient_email_hash", "message_snapshot",
            "requested_by_clerk_user_id", "provider_idempotency_key", "status",
            "attempt_count", "provider_message_id", "provider_accepted_at", "updated_at"
          )
          values
            (
              ${clientId}, ${producerId}, 'invite-owned-1', ${`sha256:${"d".repeat(64)}`},
              'owned@example.test', ${"a".repeat(64)}, ${inviteMessage}::jsonb,
              ${producerUserId}, 'client-invite:owned-1', 'provider_accepted', 1,
              'resend-owned-1', '2026-07-05T08:00:00Z', '2026-07-05T08:00:00Z'
            ),
            (
              ${foreignClientId}, ${foreignProducerId}, 'invite-foreign-1',
              ${`sha256:${"e".repeat(64)}`}, 'foreign@example.test', ${"b".repeat(64)},
              ${inviteMessage}::jsonb, ${foreignProducerUserId},
              'client-invite:foreign-1', 'provider_accepted', 1, 'resend-foreign-1',
              '2026-07-06T08:00:00Z', '2026-07-06T08:00:00Z'
            )
        `);

        const snapshot = JSON.stringify({
          productOrOfferName: "Studio session",
          lineItems: [{ quantity: 1, unitPriceCents: 12_000 }],
        });
        await tx.execute(sql`
          insert into "purchases" ("id", "producer_id", "project_id", "commercial_snapshot")
          values
            (${purchaseId}, ${producerId}, ${projectId}, ${snapshot}::jsonb),
            (
              ${otherOwnedPurchaseId}, ${producerId}, ${otherOwnedProjectId},
              ${snapshot}::jsonb
            ),
            (
              ${foreignPurchaseId}, ${foreignProducerId}, ${foreignProjectId},
              ${snapshot}::jsonb
            )
        `);
        await tx.execute(sql`
          insert into "bookings" (
            "id", "producer_id", "project_id", "purchase_id", "session_allowance_id",
            "artist_name", "artist_email", "starts_at", "duration_min",
            "operation_key", "operation_digest", "status", "outcome", "created_at"
          )
          values
            (
              ${bookingId}, ${producerId}, ${projectId}, ${purchaseId}, ${allowanceId},
              'Owned Artist', 'owned@example.test', '2026-08-02T08:00:00Z', 90,
              'sk145-owned-booking', 'owned-digest', 'confirmed', 'reserved',
              '2026-07-20T08:00:00Z'
            ),
            (
              ${pendingOwnedBookingId}, ${producerId}, ${projectId}, ${purchaseId},
              ${pendingOwnedAllowanceId}, 'Owned Artist', 'owned@example.test',
              '2026-08-01T08:00:00Z', 30, 'sk145-pending-owned-booking',
              'pending-owned-digest', 'pending_approval', 'reserved',
              '2026-07-20T08:00:00Z'
            ),
            (
              ${otherOwnedBookingId}, ${producerId}, ${otherOwnedProjectId},
              ${otherOwnedPurchaseId}, ${otherOwnedAllowanceId}, 'Owned Artist',
              'owned@example.test', '2026-08-03T08:00:00Z', 45,
              'sk145-other-owned-booking', 'other-owned-digest', 'confirmed',
              'reserved', '2026-07-20T08:00:00Z'
            ),
            (
              ${foreignBookingId}, ${foreignProducerId}, ${foreignProjectId},
              ${foreignPurchaseId}, ${foreignAllowanceId}, 'Foreign Artist',
              'foreign@example.test', '2026-08-01T08:00:00Z', 60,
              'sk145-foreign-booking', 'foreign-digest', 'confirmed', 'reserved',
              '2026-07-20T08:00:00Z'
            )
        `);
        await tx.execute(sql`
          insert into "project_tracks" ("id", "project_id", "purchase_id")
          values
            (${trackId}, ${projectId}, ${purchaseId}),
            (${foreignTrackId}, ${foreignProjectId}, ${foreignPurchaseId})
        `);
        await tx.execute(sql`
          insert into "track_versions" ("id", "track_id")
          values
            (${versionId}, ${trackId}),
            (${foreignVersionId}, ${foreignTrackId})
        `);
        await tx.execute(sql`
          insert into "track_comments" (
            "id", "version_id", "body", "timestamp_ms", "resolved_at",
            "from_producer", "created_at"
          )
          values
            (
              ${commentId}, ${versionId}, 'Owned feedback', 1500, null, false,
              '2026-07-27T11:30:00Z'
            ),
            (
              ${foreignCommentId}, ${foreignVersionId}, 'Foreign feedback', 900, null,
              false, '2026-07-28T11:30:00Z'
            )
        `);

        resolveReady(tx as unknown as Db);
        await hold;
        throw new Error(rollbackMarker);
      } catch (error) {
        rejectReady(error);
        throw error;
      }
    });

    transactionFinished = run.then(
      () => {
        throw new Error("SK-145 test transaction committed unexpectedly");
      },
      (error: unknown) => {
        if (!(error instanceof Error) || error.message !== rollbackMarker) {
          throw error;
        }
      },
    );
    isolatedDb = await ready;
    createDbForRouter.mockReturnValue(activeDb());
  }, 30_000);

  afterAll(async () => {
    releaseTransaction?.();
    try {
      await transactionFinished;
    } finally {
      createDbForRouter.mockReset();
      if (previousDatabaseUrl === undefined) {
        delete process.env.DATABASE_URL;
      } else {
        process.env.DATABASE_URL = previousDatabaseUrl;
      }
    }
  }, 30_000);

  it("returns one producer-scoped workspace and excludes foreign rows", async () => {
    const caller = clientContactsRouter.createCaller({ userId: producerUserId });
    const result = await caller.listWithProjects({ view: "workspace" });
    if (result.view !== "workspace") throw new Error("Expected workspace projection");

    expect(result.projects.map((project) => project.id)).toEqual([projectId, otherOwnedProjectId]);
    expect(result.clients.map((client) => client.id)).toEqual([clientId, otherOwnedClientId]);
    expect(result.projects[0]).toMatchObject({
      title: "Owned Project",
      unresolvedComments: 1,
      client: { id: clientId, email: "owned@example.test" },
    });
    expect(result.projects).not.toContainEqual(expect.objectContaining({ id: foreignProjectId }));
    expect(result.clients).not.toContainEqual(expect.objectContaining({ id: foreignClientId }));
    expect(result.clients[0]).toMatchObject({
      id: clientId,
      invitationState: "connected",
      providerAcceptedAt: new Date("2026-07-05T08:00:00Z"),
    });
    expect(result.clients[1]).toMatchObject({
      id: otherOwnedClientId,
      invitationState: "connected",
      providerAcceptedAt: null,
    });
  });

  it("returns lean owned Client Space data and rejects a foreign client id", async () => {
    const caller = clientContactsRouter.createCaller({ userId: producerUserId });

    const owned = await caller.clientSpaceDetail({ id: clientId });
    expect(owned.contact).toMatchObject({ id: clientId, name: "Owned Artist" });
    expect(owned.projects.map((project) => project.id)).toEqual([projectId]);
    expect(owned.stats).toMatchObject({
      activeProjectCount: 1,
      archiveBlockingProjectCount: 1,
      totalProjectCount: 1,
    });
    expect(owned.stats).not.toHaveProperty("trackCount");
    expect(owned.projects.map((project) => project.id)).not.toContain(otherOwnedProjectId);
    expect(owned).not.toHaveProperty("money");
    expect(owned).not.toHaveProperty("comments");

    await expect(caller.clientSpaceDetail({ id: foreignClientId })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("returns bookings only for the requested producer-owned project", async () => {
    const caller = bookingRouter.createCaller({ userId: producerUserId });

    const owned = await caller.list({ projectId, status: "confirmed" });
    expect(owned).toHaveLength(1);
    expect(owned[0]).toMatchObject({
      id: bookingId,
      producerId,
      projectId,
      packageNameSnapshot: "Studio session",
      unitPriceCents: 12_000,
      songQty: 1,
    });
    expect(owned.map((booking) => booking.id)).not.toContain(otherOwnedBookingId);
    expect(owned.map((booking) => booking.id)).not.toContain(pendingOwnedBookingId);

    await expect(caller.list({ projectId: foreignProjectId })).resolves.toEqual([]);
  });
});
