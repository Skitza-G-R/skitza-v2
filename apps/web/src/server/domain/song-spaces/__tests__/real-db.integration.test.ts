import { randomUUID } from "node:crypto";

import { createDb, sql, type Db, type PurchaseCommercialSnapshot } from "@skitza/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { songSpaceRepository } from "../db";
import {
  acceptNoChargeSongSpaceProposal,
  createNoChargeSongSpaceProposal,
  previewNoChargeSongSpaceProposal,
} from "../no-charge";
import { noChargeProposalRepository } from "../no-charge-db";
import { createPurchaseOwnedSongSpace } from "../service";

// This suite never falls back to DATABASE_URL. DATABASE_URL_TEST is the
// repository's explicit opt-in for a separate disposable CI/test database.
const testDatabaseUrl = process.env.DATABASE_URL_TEST;
const describeWithTestDatabase = testDatabaseUrl ? describe : describe.skip;
const testSchema = `sk92_${randomUUID().replaceAll("-", "")}`;
const noChargeSigningSecret = "sk92-real-db-test-only-signing-secret";

type TestTable =
  | "producers"
  | "client_contacts"
  | "products"
  | "projects"
  | "purchases"
  | "purchase_acceptances"
  | "purchase_installments"
  | "purchase_requests"
  | "project_tracks";

function qualifiedTestTable(table: TestTable): string {
  if (!/^sk92_[a-f0-9]{32}$/.test(testSchema)) {
    throw new Error("SK-92 generated test schema is invalid");
  }
  return `"${testSchema}"."${table}"`;
}

type TransactionFn = Db["transaction"];

function withIsolatedTransactionSchema(database: Db): Db {
  const runTransaction = database.transaction.bind(database);
  database.transaction = (async (...args: Parameters<TransactionFn>) => {
    const [work, config] = args;
    return runTransaction(async (transaction) => {
      await transaction.execute(sql.raw(`set local search_path to "${testSchema}"`));
      return work(transaction);
    }, config);
  }) as TransactionFn;
  return database;
}

type ProjectLifecycleStatus =
  | "waiting_for_payment"
  | "active"
  | "paused"
  | "completed"
  | "canceled";

type PurchaseLifecycleStatus = "waiting_for_payment" | "active" | "canceled";

type ProjectFixture = Readonly<{
  id: string;
  producerId: string;
  clientContactId: string;
  artistClerkUserId: string;
  title: string;
}>;

type PurchaseFixture = Readonly<{
  id: string;
  producerId: string;
  projectId: string;
  clientContactId: string;
  productId: string | null;
}>;

type StoredTrack = Readonly<{
  id: string;
  projectId: string;
  purchaseId: string;
  title: string;
  position: number;
}>;

type StoredPurchase = Readonly<{
  id: string;
  producerId: string;
  projectId: string;
  clientContactId: string;
  productId: string | null;
  privateOfferId: string | null;
  purchaseRequestId: string | null;
  sourceKind: string;
  lifecycleStatus: string;
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
  currency: string;
  commercialSnapshot: PurchaseCommercialSnapshot;
  acceptedAt: Date;
  activatedAt: Date | null;
}>;

type StoredAcceptance = Readonly<{
  id: string;
  purchaseId: string;
  producerId: string;
  clientContactId: string;
  acceptedByClerkUserId: string;
  snapshotDigest: string;
  acceptedAt: Date;
}>;

type RawStoredPurchase = Omit<StoredPurchase, "acceptedAt" | "activatedAt"> &
  Readonly<{
    acceptedAt: Date | string;
    activatedAt: Date | string | null;
  }>;

type RawStoredAcceptance = Omit<StoredAcceptance, "acceptedAt"> &
  Readonly<{ acceptedAt: Date | string }>;

function storedTimestamp(value: Date | string, label: string): Date {
  const parsed = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`${label} is not a valid stored timestamp`);
  }
  return parsed;
}

describeWithTestDatabase("SK-92 song-space allocation — separate CI test database", () => {
  const adminDb = testDatabaseUrl ? createDb(testDatabaseUrl) : null;
  // Distinct Db instances ensure the race tests use separate transaction
  // clients instead of relying on one in-process repository serialization.
  const transactionDbA = testDatabaseUrl
    ? withIsolatedTransactionSchema(createDb(testDatabaseUrl))
    : null;
  const transactionDbB = testDatabaseUrl
    ? withIsolatedTransactionSchema(createDb(testDatabaseUrl))
    : null;
  let schemaCreated = false;

  function activeAdminDb(): Db {
    if (!adminDb) throw new Error("SK-92 test database administrator is unavailable");
    return adminDb;
  }

  function activeTransactionDbA(): Db {
    if (!transactionDbA) throw new Error("SK-92 first transaction database is unavailable");
    return transactionDbA;
  }

  function activeTransactionDbB(): Db {
    if (!transactionDbB) throw new Error("SK-92 second transaction database is unavailable");
    return transactionDbB;
  }

  beforeAll(async () => {
    const schema = `"${testSchema}"`;
    await activeAdminDb().execute(sql.raw(`create schema ${schema}`));
    schemaCreated = true;

    const statements = [
      `create table ${schema}."producers" (
        "id" uuid primary key,
        "clerk_user_id" text not null unique,
        "display_name" text
      )`,
      `create table ${schema}."client_contacts" (
        "id" uuid primary key,
        "producer_id" uuid not null references ${schema}."producers"("id") on delete restrict,
        "clerk_user_id" text,
        "archived_at" timestamptz,
        constraint "client_contacts_id_producer_unique" unique ("id", "producer_id")
      )`,
      `create table ${schema}."products" (
        "id" uuid primary key,
        "producer_id" uuid not null references ${schema}."producers"("id") on delete restrict,
        "name" text not null,
        "currency" text not null default 'ILS',
        "archived_at" timestamptz,
        constraint "products_id_producer_unique" unique ("id", "producer_id")
      )`,
      `create table ${schema}."projects" (
        "id" uuid primary key,
        "producer_id" uuid not null references ${schema}."producers"("id") on delete restrict,
        "client_contact_id" uuid not null,
        "title" text not null,
        "lifecycle_status" text not null,
        "lifecycle_changed_at" timestamptz not null,
        "updated_at" timestamptz not null,
        constraint "projects_id_producer_unique" unique ("id", "producer_id"),
        constraint "projects_id_owner_unique" unique
          ("id", "producer_id", "client_contact_id"),
        constraint "projects_client_owner_fk" foreign key
          ("client_contact_id", "producer_id")
          references ${schema}."client_contacts"("id", "producer_id") on delete restrict
      )`,
      `create table ${schema}."purchases" (
        "id" uuid primary key default gen_random_uuid(),
        "producer_id" uuid not null,
        "project_id" uuid not null,
        "client_contact_id" uuid not null,
        "product_id" uuid,
        "private_offer_id" uuid,
        "purchase_request_id" uuid,
        "source_kind" text not null default 'store_product',
        "operation_key" text not null default gen_random_uuid()::text,
        "operation_digest" text not null default gen_random_uuid()::text,
        "ref_number" text not null default gen_random_uuid()::text,
        "lifecycle_status" text not null,
        "payment_plan_kind" text,
        "snapshot_version" integer not null default 1,
        "snapshot_digest" text not null default gen_random_uuid()::text,
        "commercial_snapshot" jsonb not null,
        "subtotal_cents" integer not null default 0,
        "tax_cents" integer not null default 0,
        "total_cents" integer not null default 0,
        "currency" text not null default 'ILS',
        "accepted_at" timestamptz not null,
        "activated_at" timestamptz,
        "canceled_at" timestamptz,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        constraint "purchases_id_project_unique" unique ("id", "project_id"),
        constraint "purchases_id_producer_client_unique" unique
          ("id", "producer_id", "client_contact_id"),
        constraint "purchases_id_owner_unique" unique
          ("id", "project_id", "producer_id", "client_contact_id"),
        constraint "purchases_operation_key_unique" unique
          ("producer_id", "client_contact_id", "operation_key"),
        constraint "purchases_ref_number_unique" unique ("ref_number"),
        constraint "purchases_project_owner_fk" foreign key
          ("project_id", "producer_id", "client_contact_id")
          references ${schema}."projects"("id", "producer_id", "client_contact_id")
          on delete restrict,
        constraint "purchases_product_owner_fk" foreign key ("product_id", "producer_id")
          references ${schema}."products"("id", "producer_id") on delete restrict
      )`,
      `create table ${schema}."purchase_acceptances" (
        "id" uuid primary key default gen_random_uuid(),
        "purchase_id" uuid not null,
        "producer_id" uuid not null,
        "client_contact_id" uuid not null,
        "accepted_by_clerk_user_id" text not null,
        "accepted_snapshot" jsonb not null,
        "snapshot_digest" text not null,
        "accepted_at" timestamptz not null,
        "created_at" timestamptz not null default now(),
        constraint "purchase_acceptances_purchase_unique" unique ("purchase_id"),
        constraint "purchase_acceptances_purchase_owner_fk" foreign key
          ("purchase_id", "producer_id", "client_contact_id")
          references ${schema}."purchases"("id", "producer_id", "client_contact_id")
          on delete restrict
      )`,
      `create table ${schema}."purchase_installments" (
        "id" uuid primary key default gen_random_uuid(),
        "purchase_id" uuid not null references ${schema}."purchases"("id") on delete restrict,
        "producer_id" uuid not null,
        "position" integer not null,
        "amount_cents" integer not null,
        "currency" text not null,
        "due_trigger" text not null,
        "due_at" timestamptz,
        "triggered_at" timestamptz,
        "required_for_activation" boolean not null default false,
        "status" text not null default 'not_paid',
        "reminders_enabled" boolean not null default true,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        constraint "purchase_installments_purchase_position_unique"
          unique ("purchase_id", "position")
      )`,
      `create table ${schema}."purchase_requests" (
        "id" uuid primary key default gen_random_uuid()
      )`,
      `create table ${schema}."project_tracks" (
        "id" uuid primary key default gen_random_uuid(),
        "project_id" uuid not null references ${schema}."projects"("id") on delete restrict,
        "purchase_id" uuid not null references ${schema}."purchases"("id") on delete restrict,
        "title" text not null,
        "artist" text,
        "position" integer not null default 0,
        "workflow_stage" text not null default 'brief',
        "artwork_r2_key" text,
        "artwork_content_type" text,
        "artwork_size_bytes" bigint,
        "artwork_object_etag" text,
        "released_at" timestamptz,
        "archived_at" timestamptz,
        "portfolio_published_at" timestamptz,
        "created_at" timestamptz not null default now(),
        constraint "project_tracks_artwork_identity_shape" check ((
          (
            "artwork_r2_key" is null
            and "artwork_content_type" is null
            and "artwork_size_bytes" is null
            and "artwork_object_etag" is null
          )
          or
          (
            nullif(btrim("artwork_r2_key"), '') is not null
            and char_length("artwork_r2_key") <= 1024
            and "artwork_content_type" in ('image/jpeg', 'image/png', 'image/webp')
            and "artwork_size_bytes" > 0
            and "artwork_size_bytes" <= 5242880
            and nullif(btrim("artwork_object_etag"), '') is not null
            and char_length("artwork_object_etag") <= 512
          )
        ) is true),
        constraint "project_tracks_purchase_project_fk" foreign key ("purchase_id", "project_id")
          references ${schema}."purchases"("id", "project_id") on delete restrict
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

  async function createProducer(
    displayName = "North Studio",
    clerkUserId = `producer_${randomUUID()}`,
  ): Promise<string> {
    const producerId = randomUUID();
    await activeAdminDb().execute(sql`
      insert into ${sql.raw(qualifiedTestTable("producers"))}
        ("id", "clerk_user_id", "display_name")
      values (${producerId}, ${clerkUserId}, ${displayName})
    `);
    return producerId;
  }

  async function createClientContact(
    producerId: string,
    artistClerkUserId: string,
  ): Promise<string> {
    const clientContactId = randomUUID();
    await activeAdminDb().execute(sql`
      insert into ${sql.raw(qualifiedTestTable("client_contacts"))}
        ("id", "producer_id", "clerk_user_id")
      values (${clientContactId}, ${producerId}, ${artistClerkUserId})
    `);
    return clientContactId;
  }

  async function createProduct(producerId: string, name = "Single Production"): Promise<string> {
    const productId = randomUUID();
    await activeAdminDb().execute(sql`
      insert into ${sql.raw(qualifiedTestTable("products"))}
        ("id", "producer_id", "name", "currency")
      values (${productId}, ${producerId}, ${name}, ${"ILS"})
    `);
    return productId;
  }

  async function createProjectFixture(
    input: Readonly<{
      producerId?: string;
      clientContactId?: string;
      artistClerkUserId?: string;
      title?: string;
      lifecycleStatus?: ProjectLifecycleStatus;
    }> = {},
  ): Promise<ProjectFixture> {
    const producerId = input.producerId ?? (await createProducer());
    const artistClerkUserId = input.artistClerkUserId ?? `artist_${randomUUID()}`;
    const clientContactId =
      input.clientContactId ?? (await createClientContact(producerId, artistClerkUserId));
    const id = randomUUID();
    const title = input.title ?? "Night Drive";
    const lifecycleChangedAt = new Date("2036-07-18T08:00:00.000Z");
    await activeAdminDb().execute(sql`
      insert into ${sql.raw(qualifiedTestTable("projects"))}
        ("id", "producer_id", "client_contact_id", "title", "lifecycle_status",
         "lifecycle_changed_at", "updated_at")
      values (${id}, ${producerId}, ${clientContactId}, ${title},
        ${input.lifecycleStatus ?? "active"}, ${lifecycleChangedAt}, ${lifecycleChangedAt})
    `);
    return { id, producerId, clientContactId, artistClerkUserId, title };
  }

  async function createPurchaseFixture(
    project: ProjectFixture,
    input: Readonly<{
      includedSongSpaces?: number;
      lifecycleStatus?: PurchaseLifecycleStatus;
      productId?: string | null;
      currency?: string;
      totalCents?: number;
      operationKey?: string;
    }> = {},
  ): Promise<PurchaseFixture> {
    const id = randomUUID();
    const totalCents = input.totalCents ?? 0;
    const commercialSnapshot = JSON.stringify({
      includedSongSpaces: input.includedSongSpaces ?? 1,
    });
    await activeAdminDb().execute(sql`
      insert into ${sql.raw(qualifiedTestTable("purchases"))}
        ("id", "producer_id", "project_id", "client_contact_id", "product_id",
         "source_kind", "operation_key", "operation_digest", "lifecycle_status",
         "commercial_snapshot", "subtotal_cents", "tax_cents", "total_cents", "currency",
         "accepted_at", "activated_at")
      values (${id}, ${project.producerId}, ${project.id}, ${project.clientContactId},
        ${input.productId ?? null}, ${"store_product"},
        ${input.operationKey ?? `fixture-${id}`}, ${`fixture-digest-${id}`},
        ${input.lifecycleStatus ?? "active"}, ${commercialSnapshot}::jsonb,
        ${totalCents}, ${0}, ${totalCents}, ${input.currency ?? "ILS"},
        ${new Date("2036-07-18T08:30:00.000Z")},
        ${
          input.lifecycleStatus === "waiting_for_payment"
            ? null
            : new Date("2036-07-18T08:30:00.000Z")
        })
    `);
    return {
      id,
      producerId: project.producerId,
      projectId: project.id,
      clientContactId: project.clientContactId,
      productId: input.productId ?? null,
    };
  }

  function allocate(
    database: Db,
    scope: Readonly<{ producerId: string; projectId: string; purchaseId: string }>,
    title: string,
    operationKey = `paid-allocation-${randomUUID()}`,
  ) {
    return createPurchaseOwnedSongSpace(songSpaceRepository(database), {
      ...scope,
      operationKey,
      title,
      createdAt: new Date("2036-07-18T09:00:00.000Z"),
    });
  }

  async function storedTracks(projectId: string): Promise<StoredTrack[]> {
    const result = await activeAdminDb().execute<StoredTrack>(sql`
      select "id", "project_id" as "projectId", "purchase_id" as "purchaseId",
        "title", "position"
      from ${sql.raw(qualifiedTestTable("project_tracks"))}
      where "project_id" = ${projectId}
      order by "position", "id"
    `);
    return [...result.rows];
  }

  async function storedPurchases(projectId: string): Promise<StoredPurchase[]> {
    const result = await activeAdminDb().execute<RawStoredPurchase>(sql`
      select "id", "producer_id" as "producerId", "project_id" as "projectId",
        "client_contact_id" as "clientContactId", "product_id" as "productId",
        "private_offer_id" as "privateOfferId",
        "purchase_request_id" as "purchaseRequestId", "source_kind" as "sourceKind",
        "lifecycle_status" as "lifecycleStatus", "subtotal_cents" as "subtotalCents",
        "tax_cents" as "taxCents", "total_cents" as "totalCents", "currency",
        "commercial_snapshot" as "commercialSnapshot", "accepted_at" as "acceptedAt",
        "activated_at" as "activatedAt"
      from ${sql.raw(qualifiedTestTable("purchases"))}
      where "project_id" = ${projectId}
      order by "accepted_at", "id"
    `);
    return result.rows.map((row) => ({
      ...row,
      acceptedAt: storedTimestamp(row.acceptedAt, "purchase acceptedAt"),
      activatedAt:
        row.activatedAt === null
          ? null
          : storedTimestamp(row.activatedAt, "purchase activatedAt"),
    }));
  }

  async function storedAcceptances(purchaseId: string): Promise<StoredAcceptance[]> {
    const result = await activeAdminDb().execute<RawStoredAcceptance>(sql`
      select "id", "purchase_id" as "purchaseId", "producer_id" as "producerId",
        "client_contact_id" as "clientContactId",
        "accepted_by_clerk_user_id" as "acceptedByClerkUserId",
        "snapshot_digest" as "snapshotDigest", "accepted_at" as "acceptedAt"
      from ${sql.raw(qualifiedTestTable("purchase_acceptances"))}
      where "purchase_id" = ${purchaseId}
      order by "id"
    `);
    return result.rows.map((row) => ({
      ...row,
      acceptedAt: storedTimestamp(row.acceptedAt, "acceptance acceptedAt"),
    }));
  }

  async function purchaseRequestCount(): Promise<number> {
    const result = await activeAdminDb().execute<{ count: number }>(sql`
      select count(*)::integer as "count"
      from ${sql.raw(qualifiedTestTable("purchase_requests"))}
    `);
    return result.rows[0]?.count ?? 0;
  }

  function requiredFixture<T>(value: T | undefined, label: string): T {
    if (value === undefined) throw new Error(`Missing ${label} fixture`);
    return value;
  }

  async function createNoChargeTarget() {
    const project = await createProjectFixture();
    const productId = await createProduct(project.producerId);
    const anchorPurchase = await createPurchaseFixture(project, {
      productId,
      totalCents: 120_000,
    });
    const anchorTrack = await allocate(
      activeTransactionDbA(),
      {
        producerId: project.producerId,
        projectId: project.id,
        purchaseId: anchorPurchase.id,
      },
      "Original purchased song",
    );
    return { project, productId, anchorPurchase, anchorTrack };
  }

  it("rejects no-charge proposal creation while an active purchased song space remains unused", async () => {
    const project = await createProjectFixture();
    const productId = await createProduct(project.producerId);
    const anchorPurchase = await createPurchaseFixture(project, {
      productId,
      totalCents: 120_000,
    });
    const repository = noChargeProposalRepository(activeTransactionDbA());

    await expect(
      createNoChargeSongSpaceProposal(repository, {
        producerId: project.producerId,
        projectId: project.id,
        operationKey: `no-charge-unused-${randomUUID()}`,
        songTitle: "Must use paid space first",
        signingSecret: noChargeSigningSecret,
      }),
    ).rejects.toMatchObject({ code: "CAPACITY_EXCEEDED" });
    expect(await storedPurchases(project.id)).toHaveLength(1);
    expect(await storedAcceptances(anchorPurchase.id)).toHaveLength(0);
    expect(await storedTracks(project.id)).toHaveLength(0);
  }, 30_000);

  it("rejects malformed artist contacts and producer identities, including at accept time", async () => {
    const malformedProject = await createProjectFixture({ artistClerkUserId: "   " });
    const malformedProductId = await createProduct(malformedProject.producerId);
    const malformedPurchase = await createPurchaseFixture(malformedProject, {
      productId: malformedProductId,
      totalCents: 120_000,
    });
    await allocate(
      activeTransactionDbA(),
      {
        producerId: malformedProject.producerId,
        projectId: malformedProject.id,
        purchaseId: malformedPurchase.id,
      },
      "Malformed contact anchor",
    );
    await expect(
      createNoChargeSongSpaceProposal(noChargeProposalRepository(activeTransactionDbA()), {
        producerId: malformedProject.producerId,
        projectId: malformedProject.id,
        operationKey: `no-charge-malformed-${randomUUID()}`,
        songTitle: "Unsafe identity",
        signingSecret: noChargeSigningSecret,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    const { project, anchorPurchase, anchorTrack } = await createNoChargeTarget();
    const repository = noChargeProposalRepository(activeTransactionDbA());
    const created = await createNoChargeSongSpaceProposal(repository, {
      producerId: project.producerId,
      projectId: project.id,
      operationKey: `no-charge-dual-role-${randomUUID()}`,
      songTitle: "Producer cannot accept",
      signingSecret: noChargeSigningSecret,
    });
    const preview = await previewNoChargeSongSpaceProposal(repository, {
      proposalToken: created.proposalToken,
      clerkUserId: project.artistClerkUserId,
      signingSecret: noChargeSigningSecret,
    });
    await createProducer("Dual-role producer", project.artistClerkUserId);

    await expect(
      previewNoChargeSongSpaceProposal(repository, {
        proposalToken: created.proposalToken,
        clerkUserId: project.artistClerkUserId,
        signingSecret: noChargeSigningSecret,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      acceptNoChargeSongSpaceProposal(repository, {
        proposalToken: created.proposalToken,
        clerkUserId: project.artistClerkUserId,
        signingSecret: noChargeSigningSecret,
        expectedSnapshotDigest: preview.snapshotDigest,
        agreementAccepted: true,
        acceptedAt: new Date("2036-07-19T09:30:00.000Z"),
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await storedPurchases(project.id)).toHaveLength(1);
    expect(await storedAcceptances(anchorPurchase.id)).toHaveLength(0);
    expect(await storedTracks(project.id)).toEqual([
      expect.objectContaining({ id: anchorTrack.id, purchaseId: anchorPurchase.id }),
    ]);
  }, 30_000);

  it("rechecks exhaustion under the project lock before creating the no-charge purchase", async () => {
    const { project, productId, anchorTrack } = await createNoChargeTarget();
    const repository = noChargeProposalRepository(activeTransactionDbA());
    const created = await createNoChargeSongSpaceProposal(repository, {
      producerId: project.producerId,
      projectId: project.id,
      operationKey: `no-charge-capacity-race-${randomUUID()}`,
      songTitle: "Extra after exhaustion",
      signingSecret: noChargeSigningSecret,
    });
    const preview = await previewNoChargeSongSpaceProposal(repository, {
      proposalToken: created.proposalToken,
      clerkUserId: project.artistClerkUserId,
      signingSecret: noChargeSigningSecret,
    });
    await createPurchaseFixture(project, {
      productId,
      totalCents: 120_000,
      operationKey: `new-unused-capacity-${randomUUID()}`,
    });

    await expect(
      acceptNoChargeSongSpaceProposal(repository, {
        proposalToken: created.proposalToken,
        clerkUserId: project.artistClerkUserId,
        signingSecret: noChargeSigningSecret,
        expectedSnapshotDigest: preview.snapshotDigest,
        agreementAccepted: true,
        acceptedAt: new Date("2036-07-19T09:45:00.000Z"),
      }),
    ).rejects.toMatchObject({ code: "CAPACITY_EXCEEDED" });
    expect((await storedPurchases(project.id)).filter((row) => row.sourceKind === "no_charge_add_on"))
      .toHaveLength(0);
    expect(await storedTracks(project.id)).toEqual([
      expect.objectContaining({ id: anchorTrack.id, position: 0 }),
    ]);
  }, 30_000);

  it("persists an artist-accepted stateless no-charge proposal as one exact product-backed graph", async () => {
    const { project, productId, anchorPurchase, anchorTrack } = await createNoChargeTarget();
    const repository = noChargeProposalRepository(activeTransactionDbA());
    const acceptedAt = new Date("2036-07-19T10:00:00.000Z");
    const songTitle = "Neon Signs";

    const created = await createNoChargeSongSpaceProposal(repository, {
      producerId: project.producerId,
      projectId: project.id,
      operationKey: `no-charge-create-${randomUUID()}`,
      songTitle,
      signingSecret: noChargeSigningSecret,
    });
    const preview = await previewNoChargeSongSpaceProposal(repository, {
      proposalToken: created.proposalToken,
      clerkUserId: project.artistClerkUserId,
      signingSecret: noChargeSigningSecret,
    });

    expect(preview).toMatchObject({
      projectId: project.id,
      projectTitle: project.title,
      songTitle,
      sourceProductId: productId,
      sourceProductName: "Single Production",
      snapshot: {
        service: "no_charge_add_on",
        totalCents: 0,
        currency: "ILS",
        includedSongSpaces: 1,
        selectedPaymentPlan: null,
      },
    });
    await expect(
      acceptNoChargeSongSpaceProposal(repository, {
        proposalToken: created.proposalToken,
        clerkUserId: "foreign_artist",
        signingSecret: noChargeSigningSecret,
        expectedSnapshotDigest: preview.snapshotDigest,
        agreementAccepted: true,
        acceptedAt,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await storedPurchases(project.id)).toHaveLength(1);
    expect(await storedAcceptances(anchorPurchase.id)).toHaveLength(0);
    expect(await storedTracks(project.id)).toEqual([
      expect.objectContaining({
        id: anchorTrack.id,
        purchaseId: anchorPurchase.id,
        position: 0,
      }),
    ]);
    expect(await purchaseRequestCount()).toBe(0);

    const accepted = await acceptNoChargeSongSpaceProposal(repository, {
      proposalToken: created.proposalToken,
      clerkUserId: project.artistClerkUserId,
      signingSecret: noChargeSigningSecret,
      expectedSnapshotDigest: preview.snapshotDigest,
      agreementAccepted: true,
      acceptedAt,
    });

    expect(accepted).toMatchObject({ projectId: project.id, created: true });
    const noChargePurchases = (await storedPurchases(project.id)).filter(
      (purchase) => purchase.sourceKind === "no_charge_add_on",
    );
    expect(noChargePurchases).toHaveLength(1);
    const purchase = requiredFixture(noChargePurchases[0], "no-charge purchase");
    expect(purchase).toMatchObject({
      id: accepted.purchaseId,
      producerId: project.producerId,
      projectId: project.id,
      clientContactId: project.clientContactId,
      productId,
      privateOfferId: null,
      purchaseRequestId: null,
      sourceKind: "no_charge_add_on",
      lifecycleStatus: "active",
      subtotalCents: 0,
      taxCents: 0,
      totalCents: 0,
      currency: "ILS",
      acceptedAt,
      activatedAt: acceptedAt,
      commercialSnapshot: {
        service: "no_charge_add_on",
        totalCents: 0,
        includedSongSpaces: 1,
        selectedPaymentPlan: null,
      },
    });
    expect(await storedAcceptances(purchase.id)).toEqual([
      expect.objectContaining({
        purchaseId: purchase.id,
        producerId: project.producerId,
        clientContactId: project.clientContactId,
        acceptedByClerkUserId: project.artistClerkUserId,
        snapshotDigest: preview.snapshotDigest,
        acceptedAt,
      }),
    ]);
    expect(await storedTracks(project.id)).toEqual([
      {
        id: anchorTrack.id,
        projectId: project.id,
        purchaseId: anchorPurchase.id,
        title: "Original purchased song",
        position: 0,
      },
      {
        id: accepted.trackId,
        projectId: project.id,
        purchaseId: purchase.id,
        title: songTitle,
        position: 1,
      },
    ]);
    expect(await purchaseRequestCount()).toBe(0);
  }, 30_000);

  it("collapses concurrent stateless no-charge acceptance across separate database connections", async () => {
    const { project, productId, anchorPurchase, anchorTrack } = await createNoChargeTarget();
    const repositoryA = noChargeProposalRepository(activeTransactionDbA());
    const repositoryB = noChargeProposalRepository(activeTransactionDbB());
    const songTitle = "One Concurrent Song";
    const created = await createNoChargeSongSpaceProposal(repositoryA, {
      producerId: project.producerId,
      projectId: project.id,
      operationKey: `no-charge-concurrent-${randomUUID()}`,
      songTitle,
      signingSecret: noChargeSigningSecret,
    });
    const preview = await previewNoChargeSongSpaceProposal(repositoryA, {
      proposalToken: created.proposalToken,
      clerkUserId: project.artistClerkUserId,
      signingSecret: noChargeSigningSecret,
    });

    const [first, replay] = await Promise.all([
      acceptNoChargeSongSpaceProposal(repositoryA, {
        proposalToken: created.proposalToken,
        clerkUserId: project.artistClerkUserId,
        signingSecret: noChargeSigningSecret,
        expectedSnapshotDigest: preview.snapshotDigest,
        agreementAccepted: true,
        acceptedAt: new Date("2036-07-19T11:00:00.000Z"),
      }),
      acceptNoChargeSongSpaceProposal(repositoryB, {
        proposalToken: created.proposalToken,
        clerkUserId: project.artistClerkUserId,
        signingSecret: noChargeSigningSecret,
        expectedSnapshotDigest: preview.snapshotDigest,
        agreementAccepted: true,
        acceptedAt: new Date("2036-07-19T11:00:01.000Z"),
      }),
    ]);

    expect(first.purchaseId).toBe(replay.purchaseId);
    expect(first.trackId).toBe(replay.trackId);
    expect([first.created, replay.created].sort()).toEqual([false, true]);
    const noChargePurchases = (await storedPurchases(project.id)).filter(
      (purchase) => purchase.sourceKind === "no_charge_add_on",
    );
    expect(noChargePurchases).toHaveLength(1);
    const purchase = requiredFixture(noChargePurchases[0], "concurrent no-charge purchase");
    expect(purchase).toMatchObject({
      id: first.purchaseId,
      productId,
      purchaseRequestId: null,
      lifecycleStatus: "active",
      totalCents: 0,
    });
    expect(await storedAcceptances(purchase.id)).toHaveLength(1);
    expect(await storedTracks(project.id)).toEqual([
      {
        id: anchorTrack.id,
        projectId: project.id,
        purchaseId: anchorPurchase.id,
        title: "Original purchased song",
        position: 0,
      },
      {
        id: first.trackId,
        projectId: project.id,
        purchaseId: purchase.id,
        title: songTitle,
        position: 1,
      },
    ]);
    expect(await purchaseRequestCount()).toBe(0);
  }, 30_000);

  it("allows exactly one winner for a one-space purchase across separate connections", async () => {
    const project = await createProjectFixture();
    const purchase = await createPurchaseFixture(project, { includedSongSpaces: 1 });
    const scope = {
      producerId: project.producerId,
      projectId: project.id,
      purchaseId: purchase.id,
    };

    const results = await Promise.allSettled([
      allocate(activeTransactionDbA(), scope, "Concurrent A"),
      allocate(activeTransactionDbB(), scope, "Concurrent B"),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(results.find((result) => result.status === "rejected")).toMatchObject({
      status: "rejected",
      reason: expect.objectContaining({ code: "CAPACITY_EXCEEDED" }) as unknown,
    });
    expect(await storedTracks(project.id)).toMatchObject([
      {
        projectId: project.id,
        purchaseId: purchase.id,
        position: 0,
      },
    ]);
  }, 30_000);

  it("replays one regular operation across separate connections without consuming capacity twice", async () => {
    const project = await createProjectFixture();
    const purchase = await createPurchaseFixture(project, { includedSongSpaces: 2 });
    const scope = {
      producerId: project.producerId,
      projectId: project.id,
      purchaseId: purchase.id,
    };
    const operationKey = `paid-replay-${randomUUID()}`;

    const [first, replay] = await Promise.all([
      allocate(activeTransactionDbA(), scope, "Same request", operationKey),
      allocate(activeTransactionDbB(), scope, "Same request", operationKey),
    ]);

    expect(replay.id).toBe(first.id);
    expect(await storedTracks(project.id)).toHaveLength(1);
  }, 30_000);

  it("serializes one regular operation key across different projects before deterministic-id lookup", async () => {
    const firstProject = await createProjectFixture();
    const secondProject = await createProjectFixture({
      producerId: firstProject.producerId,
    });
    const firstPurchase = await createPurchaseFixture(firstProject);
    const secondPurchase = await createPurchaseFixture(secondProject);
    const operationKey = `paid-cross-project-${randomUUID()}`;

    const results = await Promise.allSettled([
      allocate(
        activeTransactionDbA(),
        {
          producerId: firstProject.producerId,
          projectId: firstProject.id,
          purchaseId: firstPurchase.id,
        },
        "First project",
        operationKey,
      ),
      allocate(
        activeTransactionDbB(),
        {
          producerId: secondProject.producerId,
          projectId: secondProject.id,
          purchaseId: secondPurchase.id,
        },
        "Second project",
        operationKey,
      ),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.find((result) => result.status === "rejected")).toMatchObject({
      status: "rejected",
      reason: expect.objectContaining({ code: "OPERATION_KEY_CONFLICT" }) as unknown,
    });
    expect([
      ...(await storedTracks(firstProject.id)),
      ...(await storedTracks(secondProject.id)),
    ]).toHaveLength(1);
  }, 30_000);

  it("replays a completed regular allocation without requiring an active project", async () => {
    const project = await createProjectFixture();
    const purchase = await createPurchaseFixture(project);
    const scope = {
      producerId: project.producerId,
      projectId: project.id,
      purchaseId: purchase.id,
    };
    const operationKey = `paid-completed-replay-${randomUUID()}`;
    const first = await allocate(activeTransactionDbA(), scope, "Completed request", operationKey);
    await activeAdminDb().execute(sql`
      update ${sql.raw(qualifiedTestTable("projects"))}
      set "lifecycle_status" = ${"completed"}
      where "id" = ${project.id}
    `);

    const replay = await allocate(activeTransactionDbB(), scope, "Completed request", operationKey);

    expect(replay.id).toBe(first.id);
    expect(await storedTracks(project.id)).toHaveLength(1);
  }, 30_000);

  it("assigns unique monotonic project positions across sibling purchases", async () => {
    const project = await createProjectFixture();
    const firstPurchase = await createPurchaseFixture(project);
    const secondPurchase = await createPurchaseFixture(project);

    await Promise.all([
      allocate(
        activeTransactionDbA(),
        {
          producerId: project.producerId,
          projectId: project.id,
          purchaseId: firstPurchase.id,
        },
        "Sibling A",
      ),
      allocate(
        activeTransactionDbB(),
        {
          producerId: project.producerId,
          projectId: project.id,
          purchaseId: secondPurchase.id,
        },
        "Sibling B",
      ),
    ]);

    const tracks = await storedTracks(project.id);
    expect(tracks.map((track) => track.position)).toEqual([0, 1]);
    expect(new Set(tracks.map((track) => track.position)).size).toBe(2);
    expect(new Set(tracks.map((track) => track.purchaseId))).toEqual(
      new Set([firstPurchase.id, secondPurchase.id]),
    );
  }, 30_000);

  it("rejects producer and project mismatches without consuming either purchase", async () => {
    const producerId = await createProducer();
    const firstProject = await createProjectFixture({ producerId });
    const secondProject = await createProjectFixture({ producerId });
    const firstPurchase = await createPurchaseFixture(firstProject);
    const secondPurchase = await createPurchaseFixture(secondProject);
    const foreignProducerId = await createProducer();

    await expect(
      allocate(
        activeTransactionDbA(),
        {
          producerId,
          projectId: firstProject.id,
          purchaseId: secondPurchase.id,
        },
        "Cross-project purchase",
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      allocate(
        activeTransactionDbB(),
        {
          producerId: foreignProducerId,
          projectId: firstProject.id,
          purchaseId: firstPurchase.id,
        },
        "Foreign producer",
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    expect(await storedTracks(firstProject.id)).toHaveLength(0);
    expect(await storedTracks(secondProject.id)).toHaveLength(0);
  }, 30_000);

  it("denies waiting-payment purchases and inactive projects", async () => {
    // waiting_for_payment is the persisted state while the complete first
    // installment has not yet been confirmed, including partial payment.
    const waitingProject = await createProjectFixture();
    const waitingPurchase = await createPurchaseFixture(waitingProject, {
      lifecycleStatus: "waiting_for_payment",
    });
    const pausedProject = await createProjectFixture({ lifecycleStatus: "paused" });
    const pausedProjectPurchase = await createPurchaseFixture(pausedProject);

    await expect(
      allocate(
        activeTransactionDbA(),
        {
          producerId: waitingProject.producerId,
          projectId: waitingProject.id,
          purchaseId: waitingPurchase.id,
        },
        "Partial first installment",
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      allocate(
        activeTransactionDbB(),
        {
          producerId: pausedProject.producerId,
          projectId: pausedProject.id,
          purchaseId: pausedProjectPurchase.id,
        },
        "Paused project",
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    expect(await storedTracks(waitingProject.id)).toHaveLength(0);
    expect(await storedTracks(pausedProject.id)).toHaveLength(0);
  }, 30_000);
});
