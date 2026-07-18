import { randomUUID } from "node:crypto";

import { createDb, sql, type Db } from "@skitza/db";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { emailHashFor } from "~/server/artist/identity";
import { clientManagementRepository } from "../db";
import { archiveClient, editClient, inviteClient } from "../service";
import { historicalDeletionRepository } from "../../history-deletion/db";
import { permanentlyDeleteEmptyDraftClient } from "../../history-deletion/service";
import { stableProjectRepository } from "../../project-ownership/db";
import { createStableClientProject } from "../../project-ownership/service";

const testDatabaseUrl = process.env.DATABASE_URL_TEST;
const describeWithTestDatabase = testDatabaseUrl ? describe : describe.skip;
const testSchema = `sk93_${randomUUID().replaceAll("-", "")}`;

function qualifiedTestTable(table: "producers" | "client_contacts" | "projects"): string {
  if (!/^sk93_[a-f0-9]{32}$/.test(testSchema)) {
    throw new Error("SK-93 generated test schema is invalid");
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

describeWithTestDatabase("SK-93 client management — separate CI test database", () => {
  const adminDb = testDatabaseUrl ? createDb(testDatabaseUrl) : null;
  const transactionDb = testDatabaseUrl
    ? withIsolatedTransactionSchema(createDb(testDatabaseUrl))
    : null;
  let schemaCreated = false;

  function activeDb() {
    if (!adminDb) throw new Error("SK-93 test database is unavailable");
    return adminDb;
  }

  function activeAdminDb() {
    if (!adminDb) throw new Error("SK-93 test database administrator is unavailable");
    return adminDb;
  }

  function activeTransactionDb() {
    if (!transactionDb) throw new Error("SK-93 transaction database is unavailable");
    return transactionDb;
  }

  beforeAll(async () => {
    const schema = `"${testSchema}"`;
    await activeAdminDb().execute(sql.raw(`create schema ${schema}`));
    schemaCreated = true;

    const statements = [
      `create table ${schema}."producers" (
        "id" uuid primary key,
        "clerk_user_id" text not null unique,
        "email" text not null,
        "display_name" text,
        "slug" text not null unique
      )`,
      `create table ${schema}."client_contacts" (
        "id" uuid primary key,
        "producer_id" uuid not null,
        "email_hash" text not null,
        "email" text not null,
        "name" text not null,
        "first_seen_at" timestamptz not null default now(),
        "last_seen_at" timestamptz not null default now(),
        "tags" text[] not null default '{}',
        "notes" text,
        "phone" text,
        "referral_source" text,
        "clerk_user_id" text,
        "archived_at" timestamptz,
        "producer_archived_at" timestamptz,
        "invited_at" timestamptz,
        "position" integer not null default 0,
        constraint "client_contacts_producer_email_unique"
          unique ("producer_id", "email_hash"),
        constraint "client_contacts_id_producer_unique"
          unique ("id", "producer_id")
      )`,
      `create table ${schema}."projects" (
        "id" uuid primary key default gen_random_uuid(),
        "producer_id" uuid not null,
        "client_contact_id" uuid not null,
        "title" text not null,
        "lifecycle_status" text not null default 'waiting_for_payment',
        "lifecycle_changed_at" timestamptz not null default now(),
        "client_name" text,
        "client_email" text,
        "artist_name" text not null,
        "artist_email" text not null,
        "invite_token" text unique,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        "testimonial_requested_at" timestamptz,
        "notes" text,
        "position" integer not null default 0,
        "workflow_stage" text not null default 'brief',
        "deadline_at" timestamptz
      )`,
      `create table ${schema}."purchase_requests" (
        "producer_id" uuid,
        "client_contact_id" uuid
      )`,
      `create table ${schema}."private_offers" (
        "producer_id" uuid,
        "client_contact_id" uuid
      )`,
      `create table ${schema}."purchases" (
        "producer_id" uuid,
        "client_contact_id" uuid
      )`,
      `create table ${schema}."purchase_acceptances" (
        "producer_id" uuid,
        "client_contact_id" uuid
      )`,
      `create table ${schema}."payment_proofs" (
        "producer_id" uuid,
        "client_contact_id" uuid
      )`,
      `create table ${schema}."version_approval_events" (
        "producer_id" uuid,
        "client_contact_id" uuid
      )`,
    ];
    for (const statement of statements) {
      await activeAdminDb().execute(sql.raw(statement));
    }
  }, 30_000);

  async function createProducer(): Promise<string> {
    const key = `sk93_${randomUUID()}`;
    const producerId = randomUUID();
    await activeDb().execute(sql`
      insert into ${sql.raw(qualifiedTestTable("producers"))}
        ("id", "clerk_user_id", "email", "slug")
      values (${producerId}, ${key}, ${`${key}@example.test`}, ${key})
    `);
    return producerId;
  }

  async function createClient(producerId: string, label: string) {
    const emailLabel = label.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    const email = `${emailLabel}-${randomUUID()}@example.test`;
    const clientId = randomUUID();
    await activeDb().execute(sql`
      insert into ${sql.raw(qualifiedTestTable("client_contacts"))}
        ("id", "producer_id", "email_hash", "email", "name")
      values (${clientId}, ${producerId}, ${emailHashFor(email)}, ${email}, ${label})
    `);
    return { id: clientId, email, producerId };
  }

  afterAll(async () => {
    if (!schemaCreated) return;
    await activeAdminDb().execute(sql.raw(`drop schema "${testSchema}" cascade`));
  }, 30_000);

  it("allows exactly one concurrent winner for a producer-scoped email", async () => {
    const producerId = await createProducer();
    const [first, second] = await Promise.all([
      createClient(producerId, "Email race A"),
      createClient(producerId, "Email race B"),
    ]);
    const targetEmail = `winner-${randomUUID()}@example.test`;
    const repository = clientManagementRepository(activeTransactionDb());

    const results = await Promise.allSettled([
      editClient(repository, {
        producerId,
        clientId: first.id,
        email: targetEmail,
      }),
      editClient(repository, {
        producerId,
        clientId: second.id,
        email: targetEmail,
      }),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    const matching = await activeDb().execute<{ id: string }>(sql`
      select "id"
      from ${sql.raw(qualifiedTestTable("client_contacts"))}
      where "producer_id" = ${producerId}
        and "email_hash" = ${emailHashFor(targetEmail)}
    `);
    expect(matching.rows).toHaveLength(1);
  }, 30_000);

  it("serializes project creation with archive so only one state transition wins", async () => {
    const producerId = await createProducer();
    const client = await createClient(producerId, "Archive race");

    const results = await Promise.allSettled([
      archiveClient(clientManagementRepository(activeTransactionDb()), {
        producerId,
        clientId: client.id,
        archivedAt: new Date("2036-07-18T12:00:00.000Z"),
      }),
      createStableClientProject(stableProjectRepository(activeTransactionDb()), {
        producerId,
        clientContactId: client.id,
        title: "SK-93 archive race",
        inviteToken: `sk93-${randomUUID()}`,
        deadlineAt: null,
      }),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);

    const storedClient = await activeDb().execute<{
      producer_archived_at: Date | string | null;
    }>(sql`
      select "producer_archived_at"
      from ${sql.raw(qualifiedTestTable("client_contacts"))}
      where "id" = ${client.id}
    `);
    const storedProjects = await activeDb().execute<{ id: string }>(sql`
      select "id"
      from ${sql.raw(qualifiedTestTable("projects"))}
      where "client_contact_id" = ${client.id}
    `);
    const producerArchivedAt = storedClient.rows[0]?.producer_archived_at;
    expect(
      (producerArchivedAt === null && storedProjects.rows.length === 1) ||
        (producerArchivedAt !== null &&
          producerArchivedAt !== undefined &&
          storedProjects.rows.length === 0),
    ).toBe(true);
  }, 30_000);

  it("never delivers an invite for a concurrently deleted empty draft", async () => {
    const producerId = await createProducer();
    const client = await createClient(producerId, "Invite delete race");
    const deliverEmail = vi.fn(() => Promise.resolve());

    const results = await Promise.allSettled([
      inviteClient(clientManagementRepository(activeTransactionDb()), {
        producerId,
        clientId: client.id,
        via: "email",
        invitedAt: new Date("2036-07-18T12:00:00.000Z"),
        deliverEmail,
      }),
      permanentlyDeleteEmptyDraftClient(historicalDeletionRepository(activeTransactionDb()), {
        producerId,
        clientId: client.id,
      }),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);

    const remaining = await activeDb().execute<{ invited_at: Date | string | null }>(sql`
      select "invited_at"
      from ${sql.raw(qualifiedTestTable("client_contacts"))}
      where "id" = ${client.id}
    `);
    if (results[0].status === "fulfilled") {
      expect(deliverEmail).toHaveBeenCalledTimes(1);
      expect(remaining.rows).toHaveLength(1);
      expect(new Date(remaining.rows[0]!.invited_at!).getTime()).toBe(
        new Date("2036-07-18T12:00:00.000Z").getTime(),
      );
    } else {
      expect(deliverEmail).not.toHaveBeenCalled();
      expect(remaining.rows).toHaveLength(0);
    }
  }, 30_000);

  it("permanently deletes a genuinely empty client with no history", async () => {
    const producerId = await createProducer();
    const client = await createClient(producerId, "Empty draft");

    await expect(
      permanentlyDeleteEmptyDraftClient(historicalDeletionRepository(activeTransactionDb()), {
        producerId,
        clientId: client.id,
      }),
    ).resolves.toEqual({ deleted: true });

    const remaining = await activeDb().execute<{ id: string }>(sql`
      select "id"
      from ${sql.raw(qualifiedTestTable("client_contacts"))}
      where "id" = ${client.id}
    `);
    expect(remaining.rows).toHaveLength(0);
  }, 30_000);
});
