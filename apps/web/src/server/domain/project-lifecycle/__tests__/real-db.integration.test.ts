import { randomUUID } from "node:crypto";

import { createDb, sql, type Db } from "@skitza/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { clientManagementRepository } from "../../client-management/db";
import { archiveClient } from "../../client-management/service";
import { historicalDeletionRepository } from "../../history-deletion/db";
import { permanentlyDeleteEmptyDraftProject } from "../../history-deletion/service";
import { projectLifecycleRepository } from "../db";
import { projectAdvisoryLockKey } from "../lock";
import {
  cancelProject,
  cancelProjectPurchase,
  completeProject,
  editProject,
  PROJECT_REOPEN_ARCHIVED_CLIENT_MESSAGE,
  reopenProject,
} from "../service";

const testDatabaseUrl = process.env.DATABASE_URL_TEST;
const describeWithTestDatabase = testDatabaseUrl ? describe : describe.skip;
const testSchema = `sk12_${randomUUID().replaceAll("-", "")}`;

type TestTable =
  | "producers"
  | "client_contacts"
  | "projects"
  | "purchases"
  | "purchase_installments"
  | "payment_proofs"
  | "purchase_payments"
  | "purchase_payment_corrections"
  | "purchase_waivers"
  | "purchase_cancellations"
  | "project_payment_pause_events"
  | "purchase_session_allowances"
  | "project_tracks"
  | "track_versions"
  | "track_comments"
  | "song_public_links"
  | "bookings"
  | "purchase_requests"
  | "private_offers"
  | "notifications";

function qualifiedTestTable(table: TestTable): string {
  if (!/^sk12_[a-f0-9]{32}$/.test(testSchema)) {
    throw new Error("SK-12 generated test schema is invalid");
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

type DbDate = Date | string;

type ProjectFixture = Readonly<{
  id: string;
  producerId: string;
  clientContactId: string;
  artistName: string;
  artistEmail: string;
}>;

type PurchaseFixture = Readonly<{
  id: string;
  producerId: string;
  projectId: string;
}>;

type StoredProject = Readonly<{
  id: string;
  producerId: string;
  clientContactId: string;
  title: string;
  lifecycleStatus: string;
  lifecycleChangedAt: DbDate;
  artistName: string;
  artistEmail: string;
  workflowStage: string;
  deadlineAt: DbDate | null;
  updatedAt: DbDate;
}>;

type StoredPurchase = Readonly<{
  id: string;
  lifecycleStatus: string;
  canceledAt: DbDate | null;
  updatedAt: DbDate;
}>;

type StoredInstallment = Readonly<{
  id: string;
  purchaseId: string;
  position: number;
  status: string;
  dueAt: DbDate | null;
  triggeredAt: DbDate | null;
  remindersEnabled: boolean;
  updatedAt: DbDate;
}>;

type StoredAllowance = Readonly<{
  id: string;
  purchaseId: string;
  closedAt: DbDate | null;
  closeReason: string | null;
}>;

function time(value: DbDate | null): number | null {
  return value === null ? null : new Date(value).getTime();
}

describeWithTestDatabase("SK-12 project lifecycle — separate CI test database", () => {
  const adminDb = testDatabaseUrl ? createDb(testDatabaseUrl) : null;
  const transactionDb = testDatabaseUrl
    ? withIsolatedTransactionSchema(createDb(testDatabaseUrl))
    : null;
  let schemaCreated = false;

  function activeAdminDb(): Db {
    if (!adminDb) throw new Error("SK-12 test database administrator is unavailable");
    return adminDb;
  }

  function activeTransactionDb(): Db {
    if (!transactionDb) throw new Error("SK-12 transaction database is unavailable");
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
        "timezone" text not null default 'UTC',
        "autopilot_unpaid_reminder" boolean not null default true,
        "slug" text not null unique
      )`,
      `create table ${schema}."client_contacts" (
        "id" uuid primary key,
        "producer_id" uuid not null references ${schema}."producers"("id") on delete restrict,
        "email_hash" text not null,
        "email" text not null,
        "name" text not null,
        "phone" text,
        "notes" text,
        "tags" text[] not null default '{}',
        "clerk_user_id" text,
        "invited_at" timestamptz,
        "archived_at" timestamptz,
        "producer_archived_at" timestamptz,
        constraint "client_contacts_id_producer_unique" unique ("id", "producer_id")
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
        "deadline_at" timestamptz,
        "updated_at" timestamptz not null,
        constraint "projects_id_producer_unique" unique ("id", "producer_id"),
        constraint "projects_id_owner_unique" unique ("id", "producer_id", "client_contact_id"),
        constraint "projects_client_producer_fk" foreign key ("client_contact_id", "producer_id")
          references ${schema}."client_contacts"("id", "producer_id") on delete restrict
      )`,
      `create table ${schema}."purchases" (
        "id" uuid primary key,
        "producer_id" uuid not null,
        "project_id" uuid not null,
        "client_contact_id" uuid not null,
        "source_kind" text not null default 'store_product',
        "ref_number" text not null unique,
        "lifecycle_status" text not null,
        "payment_plan_kind" text,
        "commercial_snapshot" jsonb not null,
        "subtotal_cents" integer not null,
        "tax_cents" integer not null,
        "total_cents" integer not null,
        "currency" text not null,
        "accepted_at" timestamptz,
        "commercial_established_at" timestamptz not null,
        "activated_at" timestamptz,
        "canceled_at" timestamptz,
        "updated_at" timestamptz not null,
        constraint "purchases_id_producer_unique" unique ("id", "producer_id"),
        constraint "purchases_project_owner_fk" foreign key
          ("project_id", "producer_id", "client_contact_id")
          references ${schema}."projects"("id", "producer_id", "client_contact_id")
          on delete restrict,
        constraint "purchases_commercial_establishment_shape" check ((
          ("source_kind" = 'imported_existing_work' and "accepted_at" is null)
          or ("source_kind" <> 'imported_existing_work'
            and "accepted_at" = "commercial_established_at")
        ) is true)
      )`,
      // Mirrors migration 0055: accepted Purchases inserted without an explicit
      // establishment time are established at Artist acceptance.
      `create function ${schema}."default_purchase_commercial_established_at"()
      returns trigger as $function$
      begin
        new."commercial_established_at" :=
          coalesce(new."commercial_established_at", new."accepted_at");
        return new;
      end;
      $function$ language plpgsql`,
      `create trigger "purchases_default_commercial_established_at"
        before insert on ${schema}."purchases"
        for each row execute function ${schema}."default_purchase_commercial_established_at"()`,
      `create table ${schema}."purchase_installments" (
        "id" uuid primary key,
        "purchase_id" uuid not null,
        "producer_id" uuid not null,
        "position" integer not null,
        "amount_cents" integer not null,
        "currency" text not null,
        "due_trigger" text not null,
        "due_at" timestamptz,
        "triggered_at" timestamptz,
        "required_for_activation" boolean not null default false,
        "status" text not null,
        "reminders_enabled" boolean not null default true,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null,
        constraint "purchase_installments_purchase_position_unique"
          unique ("purchase_id", "position"),
        constraint "purchase_installments_purchase_producer_fk"
          foreign key ("purchase_id", "producer_id")
          references ${schema}."purchases"("id", "producer_id") on delete restrict
      )`,
      `create table ${schema}."payment_proofs" (
        "id" uuid primary key,
        "purchase_id" uuid not null,
        "installment_id" uuid not null,
        "producer_id" uuid not null,
        "status" text not null
      )`,
      `create table ${schema}."purchase_payments" (
        "id" uuid primary key,
        "purchase_id" uuid not null references ${schema}."purchases"("id") on delete restrict,
        "installment_id" uuid not null,
        "producer_id" uuid not null,
        "proof_id" uuid,
        "operation_key" text not null,
        "operation_digest" text not null,
        "source" text not null,
        "amount_cents" integer not null,
        "currency" text not null,
        "paid_at" timestamptz not null,
        "added_by_clerk_user_id" text not null,
        "note" text,
        "created_at" timestamptz not null default now()
      )`,
      `create table ${schema}."purchase_payment_corrections" (
        "id" uuid primary key default gen_random_uuid(),
        "purchase_id" uuid not null,
        "payment_id" uuid not null,
        "producer_id" uuid not null,
        "operation_key" text not null,
        "operation_digest" text not null,
        "sequence" integer not null,
        "previous_amount_cents" integer not null,
        "new_amount_cents" integer not null,
        "reason" text not null,
        "corrected_by_clerk_user_id" text not null,
        "created_at" timestamptz not null default now()
      )`,
      `create table ${schema}."purchase_waivers" (
        "id" uuid primary key,
        "purchase_id" uuid not null references ${schema}."purchases"("id") on delete restrict,
        "installment_id" uuid not null,
        "producer_id" uuid not null,
        "operation_key" text not null,
        "operation_digest" text not null,
        "amount_cents" integer not null,
        "reason" text not null,
        "waived_by_clerk_user_id" text not null,
        "created_at" timestamptz not null default now()
      )`,
      `create table ${schema}."purchase_cancellations" (
        "id" uuid primary key default gen_random_uuid(),
        "purchase_id" uuid not null unique references ${schema}."purchases"("id") on delete restrict,
        "producer_id" uuid not null,
        "operation_key" text not null,
        "operation_digest" text not null,
        "reason" text not null,
        "canceled_by_clerk_user_id" text not null,
        "canceled_at" timestamptz not null,
        "created_at" timestamptz not null default now()
      )`,
      `create table ${schema}."project_payment_pause_events" (
        "id" uuid primary key default gen_random_uuid(),
        "purchase_id" uuid not null,
        "project_id" uuid not null,
        "producer_id" uuid not null,
        "action" text not null,
        "operation_key" text not null,
        "operation_digest" text not null,
        "reason" text not null,
        "changed_by_clerk_user_id" text not null,
        "changed_at" timestamptz not null,
        "created_at" timestamptz not null default now()
      )`,
      `create table ${schema}."purchase_session_allowances" (
        "id" uuid primary key,
        "purchase_id" uuid not null unique,
        "producer_id" uuid not null,
        "kind" text not null,
        "session_limit" integer,
        "duration_min" integer not null,
        "location_type" text not null,
        "buffer_minutes" integer not null,
        "min_lead_hours" integer not null,
        "closed_at" timestamptz,
        "close_reason" text,
        constraint "purchase_session_allowances_purchase_producer_fk"
          foreign key ("purchase_id", "producer_id")
          references ${schema}."purchases"("id", "producer_id") on delete restrict
      )`,
      `create table ${schema}."project_tracks" (
        "id" uuid primary key,
        "project_id" uuid not null references ${schema}."projects"("id") on delete restrict,
        "purchase_id" uuid not null references ${schema}."purchases"("id") on delete restrict,
        "title" text not null
      )`,
      `create table ${schema}."track_versions" (
        "id" uuid primary key,
        "track_id" uuid not null references ${schema}."project_tracks"("id") on delete restrict,
        "purchase_id" uuid not null references ${schema}."purchases"("id") on delete restrict,
        "producer_id" uuid not null,
        "label" text not null
      )`,
      `create table ${schema}."track_comments" (
        "id" uuid primary key,
        "version_id" uuid not null references ${schema}."track_versions"("id") on delete restrict,
        "producer_id" uuid not null,
        "body" text not null
      )`,
      `create table ${schema}."song_public_links" (
        "id" uuid primary key,
        "track_id" uuid not null unique references ${schema}."project_tracks"("id") on delete restrict,
        "purchase_id" uuid not null references ${schema}."purchases"("id") on delete restrict,
        "producer_id" uuid not null,
        "token_hash" text not null unique,
        "enabled_at" timestamptz not null,
        "disabled_at" timestamptz
      )`,
      `create table ${schema}."bookings" (
        "id" uuid primary key,
        "producer_id" uuid not null,
        "project_id" uuid not null references ${schema}."projects"("id") on delete restrict,
        "purchase_id" uuid references ${schema}."purchases"("id") on delete restrict
      )`,
      `create table ${schema}."purchase_requests" (
        "id" uuid primary key,
        "producer_id" uuid not null,
        "project_id" uuid references ${schema}."projects"("id") on delete restrict
      )`,
      `create table ${schema}."private_offers" (
        "id" uuid primary key,
        "producer_id" uuid not null,
        "target_project_id" uuid references ${schema}."projects"("id") on delete restrict
      )`,
      `create table ${schema}."notifications" (
        "id" uuid primary key,
        "producer_id" uuid not null,
        "project_id" uuid references ${schema}."projects"("id") on delete restrict
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
    const key = `sk12-${randomUUID()}`;
    await activeAdminDb().execute(sql`
      insert into ${sql.raw(qualifiedTestTable("producers"))}
        ("id", "clerk_user_id", "email", "display_name", "timezone", "slug")
      values (${producerId}, ${key}, ${`${key}@example.test`}, ${"Fixture producer"},
        ${"America/New_York"}, ${key})
    `);
    return producerId;
  }

  async function createProjectFixture(
    lifecycleStatus:
      | "waiting_for_payment"
      | "active"
      | "paused"
      | "completed"
      | "canceled" = "active",
  ): Promise<ProjectFixture> {
    const producerId = await createProducer();
    const clientContactId = randomUUID();
    const projectId = randomUUID();
    const email = `artist-${randomUUID()}@example.test`;
    const artistName = `Artist ${randomUUID()}`;
    const createdAt = new Date("2036-07-18T08:00:00.000Z");
    await activeAdminDb().execute(sql`
      insert into ${sql.raw(qualifiedTestTable("client_contacts"))}
        ("id", "producer_id", "email_hash", "email", "name")
      values (${clientContactId}, ${producerId}, ${`hash-${clientContactId}`}, ${email}, ${artistName})
    `);
    await activeAdminDb().execute(sql`
      insert into ${sql.raw(qualifiedTestTable("projects"))}
        ("id", "producer_id", "client_contact_id", "title", "lifecycle_status",
         "lifecycle_changed_at", "artist_name", "artist_email", "workflow_stage", "updated_at")
      values (${projectId}, ${producerId}, ${clientContactId}, ${"Original project"},
        ${lifecycleStatus}, ${createdAt}, ${artistName}, ${email}, ${"production"}, ${createdAt})
    `);
    return { id: projectId, producerId, clientContactId, artistName, artistEmail: email };
  }

  async function createPurchaseFixture(
    project: ProjectFixture,
    lifecycleStatus: "waiting_for_payment" | "active" | "canceled" = "active",
  ): Promise<PurchaseFixture> {
    const id = randomUUID();
    const acceptedAt = new Date("2036-07-18T08:30:00.000Z");
    const activatedAt = lifecycleStatus === "waiting_for_payment" ? null : acceptedAt;
    const canceledAt = lifecycleStatus === "canceled" ? new Date("2036-07-18T09:00:00.000Z") : null;
    const refNumber = `SK-${id}`;
    const commercialSnapshot = JSON.stringify({ productOrOfferName: "Fixture purchase" });
    await activeAdminDb().execute(sql`
      insert into ${sql.raw(qualifiedTestTable("purchases"))}
        ("id", "producer_id", "project_id", "client_contact_id", "ref_number",
         "lifecycle_status", "payment_plan_kind", "commercial_snapshot", "subtotal_cents",
         "tax_cents", "total_cents", "currency", "accepted_at", "activated_at", "canceled_at",
         "updated_at")
      values (${id}, ${project.producerId}, ${project.id}, ${project.clientContactId},
        ${refNumber}, ${lifecycleStatus}, ${null}, ${commercialSnapshot}::jsonb, ${0}, ${0}, ${0},
        ${"USD"}, ${acceptedAt}, ${activatedAt}, ${canceledAt}, ${canceledAt ?? acceptedAt})
    `);
    return { id, producerId: project.producerId, projectId: project.id };
  }

  async function createInstallment(
    purchase: PurchaseFixture,
    input: Readonly<{
      position: number;
      status?: string;
      dueAt?: Date | null;
      triggeredAt?: Date | null;
      dueTrigger?: "acceptance" | "monthly_anniversary" | "artist_approval";
      requiredForActivation?: boolean;
      remindersEnabled?: boolean;
    }>,
  ): Promise<string> {
    const id = randomUUID();
    const updatedAt = new Date("2036-07-18T08:30:00.000Z");
    await activeAdminDb().execute(sql`
      insert into ${sql.raw(qualifiedTestTable("purchase_installments"))}
        ("id", "purchase_id", "producer_id", "position", "amount_cents", "currency",
         "due_trigger", "due_at", "triggered_at", "required_for_activation", "status",
         "reminders_enabled", "updated_at")
      values (${id}, ${purchase.id}, ${purchase.producerId}, ${input.position},
        ${1000 * input.position}, ${"USD"}, ${input.dueTrigger ?? "monthly_anniversary"},
        ${input.dueAt ?? null}, ${input.triggeredAt ?? null},
        ${input.requiredForActivation ?? false}, ${input.status ?? "not_paid"},
        ${input.remindersEnabled ?? true}, ${updatedAt})
    `);
    await activeAdminDb().execute(sql`
      update ${sql.raw(qualifiedTestTable("purchase_installments"))}
      set "required_for_activation" = ("id" = (
        select "id" from ${sql.raw(qualifiedTestTable("purchase_installments"))}
        where "purchase_id" = ${purchase.id}
        order by "position", "id"
        limit 1
      ))
      where "purchase_id" = ${purchase.id}
    `);
    await activeAdminDb().execute(sql`
      update ${sql.raw(qualifiedTestTable("purchases"))}
      set "payment_plan_kind" = ${"full"},
          "subtotal_cents" = totals."amount_cents",
          "total_cents" = totals."amount_cents"
      from (
        select coalesce(sum("amount_cents"), 0)::integer as "amount_cents"
        from ${sql.raw(qualifiedTestTable("purchase_installments"))}
        where "purchase_id" = ${purchase.id}
      ) totals
      where "id" = ${purchase.id}
    `);
    return id;
  }

  async function createAllowance(
    purchase: PurchaseFixture,
    input: Readonly<{
      closedAt?: Date | null;
      closeReason?: "project_completed" | "project_canceled" | "purchase_canceled" | null;
    }> = {},
  ): Promise<string> {
    const id = randomUUID();
    await activeAdminDb().execute(sql`
      insert into ${sql.raw(qualifiedTestTable("purchase_session_allowances"))}
        ("id", "purchase_id", "producer_id", "kind", "session_limit", "duration_min",
         "location_type", "buffer_minutes", "min_lead_hours", "closed_at", "close_reason")
      values (${id}, ${purchase.id}, ${purchase.producerId}, ${"fixed"}, ${2}, ${60},
        ${"studio"}, ${15}, ${24}, ${input.closedAt ?? null}, ${input.closeReason ?? null})
    `);
    return id;
  }

  async function createCancellation(
    purchase: PurchaseFixture,
    canceledAt: Date,
    reason = "Existing cancellation",
  ): Promise<void> {
    await activeAdminDb().execute(sql`
      insert into ${sql.raw(qualifiedTestTable("purchase_cancellations"))}
        ("purchase_id", "producer_id", "operation_key", "operation_digest", "reason",
         "canceled_by_clerk_user_id", "canceled_at")
      values (${purchase.id}, ${purchase.producerId}, ${`fixture-cancellation:${purchase.id}`},
        ${`fixture-cancellation-digest:${purchase.id}`}, ${reason}, ${"fixture-actor"}, ${canceledAt})
    `);
  }

  async function createRetainedHistory(
    project: ProjectFixture,
    purchase: PurchaseFixture,
  ): Promise<void> {
    const installmentId = await createInstallment(purchase, {
      position: 90,
      status: "confirmed",
      dueAt: new Date("2036-07-17T12:00:00.000Z"),
      triggeredAt: new Date("2036-07-17T10:00:00.000Z"),
    });
    const paymentId = randomUUID();
    const waiverId = randomUUID();
    const trackId = randomUUID();
    const versionId = randomUUID();
    const commentId = randomUUID();
    const publicLinkId = randomUUID();
    const bookingId = randomUUID();
    await activeAdminDb().execute(sql`
      insert into ${sql.raw(qualifiedTestTable("purchase_payments"))}
        ("id", "purchase_id", "installment_id", "producer_id", "operation_key",
         "operation_digest", "source", "amount_cents", "currency", "paid_at",
         "added_by_clerk_user_id")
      values (${paymentId}, ${purchase.id}, ${installmentId}, ${purchase.producerId},
        ${`fixture-payment:${paymentId}`}, ${`fixture-payment-digest:${paymentId}`}, ${"manual"},
        ${9000}, ${"USD"}, ${new Date("2036-07-17T12:00:00.000Z")}, ${"fixture-actor"})
    `);
    await activeAdminDb().execute(sql`
      insert into ${sql.raw(qualifiedTestTable("purchase_waivers"))}
        ("id", "purchase_id", "installment_id", "producer_id", "operation_key",
         "operation_digest", "amount_cents", "reason", "waived_by_clerk_user_id")
      values (${waiverId}, ${purchase.id}, ${installmentId}, ${purchase.producerId},
        ${`fixture-waiver:${waiverId}`}, ${`fixture-waiver-digest:${waiverId}`}, ${500},
        ${"Fixture waiver"}, ${"fixture-actor"})
    `);
    await activeAdminDb().execute(sql`
      insert into ${sql.raw(qualifiedTestTable("project_tracks"))}
        ("id", "project_id", "purchase_id", "title")
      values (${trackId}, ${project.id}, ${purchase.id}, ${"Retained song"})
    `);
    await activeAdminDb().execute(sql`
      insert into ${sql.raw(qualifiedTestTable("track_versions"))}
        ("id", "track_id", "purchase_id", "producer_id", "label")
      values (${versionId}, ${trackId}, ${purchase.id}, ${project.producerId}, ${"V1"})
    `);
    await activeAdminDb().execute(sql`
      insert into ${sql.raw(qualifiedTestTable("track_comments"))}
        ("id", "version_id", "producer_id", "body")
      values (${commentId}, ${versionId}, ${project.producerId}, ${"Keep this comment"})
    `);
    await activeAdminDb().execute(sql`
      insert into ${sql.raw(qualifiedTestTable("song_public_links"))}
        ("id", "track_id", "purchase_id", "producer_id", "token_hash", "enabled_at")
      values (${publicLinkId}, ${trackId}, ${purchase.id}, ${project.producerId},
        ${`token-${publicLinkId}`}, ${new Date("2036-07-17T13:00:00.000Z")})
    `);
    await activeAdminDb().execute(sql`
      insert into ${sql.raw(qualifiedTestTable("bookings"))}
        ("id", "producer_id", "project_id", "purchase_id")
      values (${bookingId}, ${project.producerId}, ${project.id}, ${purchase.id})
    `);
  }

  async function storedProject(projectId: string): Promise<StoredProject | null> {
    const result = await activeAdminDb().execute<StoredProject>(sql`
      select "id", "producer_id" as "producerId", "client_contact_id" as "clientContactId",
        "title", "lifecycle_status" as "lifecycleStatus",
        "lifecycle_changed_at" as "lifecycleChangedAt", "artist_name" as "artistName",
        "artist_email" as "artistEmail", "workflow_stage" as "workflowStage",
        "deadline_at" as "deadlineAt", "updated_at" as "updatedAt"
      from ${sql.raw(qualifiedTestTable("projects"))}
      where "id" = ${projectId}
    `);
    return result.rows[0] ?? null;
  }

  async function storedClientProducerArchivedAt(clientId: string): Promise<DbDate | null> {
    const result = await activeAdminDb().execute<{ producerArchivedAt: DbDate | null }>(sql`
      select "producer_archived_at" as "producerArchivedAt"
      from ${sql.raw(qualifiedTestTable("client_contacts"))}
      where "id" = ${clientId}
    `);
    return result.rows[0]?.producerArchivedAt ?? null;
  }

  async function storedPurchases(projectId: string): Promise<StoredPurchase[]> {
    const result = await activeAdminDb().execute<StoredPurchase>(sql`
      select "id", "lifecycle_status" as "lifecycleStatus", "canceled_at" as "canceledAt",
        "updated_at" as "updatedAt"
      from ${sql.raw(qualifiedTestTable("purchases"))}
      where "project_id" = ${projectId}
      order by "id"
    `);
    return [...result.rows];
  }

  async function storedInstallments(projectId: string): Promise<StoredInstallment[]> {
    const result = await activeAdminDb().execute<StoredInstallment>(sql`
      select i."id", i."purchase_id" as "purchaseId", i."position", i."status",
        i."due_at" as "dueAt", i."triggered_at" as "triggeredAt",
        i."reminders_enabled" as "remindersEnabled", i."updated_at" as "updatedAt"
      from ${sql.raw(qualifiedTestTable("purchase_installments"))} i
      inner join ${sql.raw(qualifiedTestTable("purchases"))} p on p."id" = i."purchase_id"
      where p."project_id" = ${projectId}
      order by i."position", i."id"
    `);
    return [...result.rows];
  }

  async function storedAllowances(projectId: string): Promise<StoredAllowance[]> {
    const result = await activeAdminDb().execute<StoredAllowance>(sql`
      select a."id", a."purchase_id" as "purchaseId", a."closed_at" as "closedAt",
        a."close_reason" as "closeReason"
      from ${sql.raw(qualifiedTestTable("purchase_session_allowances"))} a
      inner join ${sql.raw(qualifiedTestTable("purchases"))} p on p."id" = a."purchase_id"
      where p."project_id" = ${projectId}
      order by a."purchase_id"
    `);
    return [...result.rows];
  }

  async function moneyRows(projectId: string): Promise<Readonly<Record<string, unknown>>> {
    const payments = await activeAdminDb().execute(sql`
      select pp."id", pp."purchase_id", pp."amount_cents", pp."paid_at"
      from ${sql.raw(qualifiedTestTable("purchase_payments"))} pp
      inner join ${sql.raw(qualifiedTestTable("purchases"))} p on p."id" = pp."purchase_id"
      where p."project_id" = ${projectId}
      order by pp."id"
    `);
    const waivers = await activeAdminDb().execute(sql`
      select pw."id", pw."purchase_id", pw."amount_cents", pw."reason"
      from ${sql.raw(qualifiedTestTable("purchase_waivers"))} pw
      inner join ${sql.raw(qualifiedTestTable("purchases"))} p on p."id" = pw."purchase_id"
      where p."project_id" = ${projectId}
      order by pw."id"
    `);
    return { payments: [...payments.rows], waivers: [...waivers.rows] };
  }

  async function retainedHistoryCounts(
    projectId: string,
  ): Promise<Readonly<Record<string, number>>> {
    const result = await activeAdminDb().execute<{
      tracks: number;
      versions: number;
      comments: number;
      publicLinks: number;
      bookings: number;
    }>(sql`
      select
        (select count(*)::int from ${sql.raw(qualifiedTestTable("project_tracks"))}
          where "project_id" = ${projectId}) as "tracks",
        (select count(*)::int from ${sql.raw(qualifiedTestTable("track_versions"))} v
          inner join ${sql.raw(qualifiedTestTable("project_tracks"))} t on t."id" = v."track_id"
          where t."project_id" = ${projectId}) as "versions",
        (select count(*)::int from ${sql.raw(qualifiedTestTable("track_comments"))} c
          inner join ${sql.raw(qualifiedTestTable("track_versions"))} v on v."id" = c."version_id"
          inner join ${sql.raw(qualifiedTestTable("project_tracks"))} t on t."id" = v."track_id"
          where t."project_id" = ${projectId}) as "comments",
        (select count(*)::int from ${sql.raw(qualifiedTestTable("song_public_links"))} l
          inner join ${sql.raw(qualifiedTestTable("project_tracks"))} t on t."id" = l."track_id"
          where t."project_id" = ${projectId}) as "publicLinks",
        (select count(*)::int from ${sql.raw(qualifiedTestTable("bookings"))}
          where "project_id" = ${projectId}) as "bookings"
    `);
    const row = result.rows[0];
    if (!row) throw new Error("SK-12 retained-history count query returned no row");
    return row;
  }

  async function cancellationCount(projectId: string): Promise<number> {
    const result = await activeAdminDb().execute<{ count: number }>(sql`
      select count(*)::int as "count"
      from ${sql.raw(qualifiedTestTable("purchase_cancellations"))} c
      inner join ${sql.raw(qualifiedTestTable("purchases"))} p on p."id" = c."purchase_id"
      where p."project_id" = ${projectId}
    `);
    return result.rows[0]?.count ?? 0;
  }

  it("edits project metadata without changing the stable client or owner", async () => {
    const project = await createProjectFixture();
    const changedAt = new Date("2036-07-18T10:00:00.000Z");
    const deadlineAt = new Date("2036-08-01T18:00:00.000Z");

    const result = await editProject(projectLifecycleRepository(activeTransactionDb()), {
      producerId: project.producerId,
      projectId: project.id,
      title: "  Edited project  ",
      deadlineAt,
      workflowStage: "mixing",
      changedAt,
    });

    expect(result.changed).toBe(true);
    const stored = await storedProject(project.id);
    expect(stored).toMatchObject({
      producerId: project.producerId,
      clientContactId: project.clientContactId,
      artistName: project.artistName,
      artistEmail: project.artistEmail,
      title: "Edited project",
      workflowStage: "mixing",
      lifecycleStatus: "active",
    });
    expect(time(stored?.deadlineAt ?? null)).toBe(deadlineAt.getTime());
    expect(time(stored?.updatedAt ?? null)).toBe(changedAt.getTime());

    await expect(
      editProject(projectLifecycleRepository(activeTransactionDb()), {
        producerId: project.producerId,
        projectId: project.id,
        deadlineAt: null,
        changedAt: new Date("2036-07-18T11:00:00.000Z"),
      }),
    ).resolves.toMatchObject({ changed: true });
    expect((await storedProject(project.id))?.deadlineAt).toBeNull();
  }, 30_000);

  it("completes atomically while preserving debt, music, comments, sessions, and public links", async () => {
    const project = await createProjectFixture("active");
    const purchase = await createPurchaseFixture(project);
    await createInstallment(purchase, {
      position: 1,
      dueAt: new Date("2036-07-18T09:00:00.000Z"),
    });
    await createAllowance(purchase);
    await createRetainedHistory(project, purchase);
    const beforePurchases = await storedPurchases(project.id);
    const beforeInstallments = await storedInstallments(project.id);
    const beforeMoney = await moneyRows(project.id);
    const beforeHistory = await retainedHistoryCounts(project.id);
    const completedAt = new Date("2036-07-18T12:00:00.000Z");

    const result = await completeProject(projectLifecycleRepository(activeTransactionDb()), {
      producerId: project.producerId,
      projectId: project.id,
      completedAt,
    });

    expect(result).toMatchObject({ changed: true, closedAllowances: 1 });
    const stored = await storedProject(project.id);
    expect(stored?.lifecycleStatus).toBe("completed");
    expect(time(stored?.lifecycleChangedAt ?? null)).toBe(completedAt.getTime());
    expect(await storedPurchases(project.id)).toEqual(beforePurchases);
    expect(await storedInstallments(project.id)).toEqual(beforeInstallments);
    expect(await moneyRows(project.id)).toEqual(beforeMoney);
    expect(await retainedHistoryCounts(project.id)).toEqual(beforeHistory);
    expect(await cancellationCount(project.id)).toBe(0);
    const allowances = await storedAllowances(project.id);
    expect(allowances).toHaveLength(1);
    expect(allowances[0]).toMatchObject({ closeReason: "project_completed" });
    expect(time(allowances[0]?.closedAt ?? null)).toBe(completedAt.getTime());
  }, 30_000);

  it("cancels only future untouched installments and creates no money movement", async () => {
    const project = await createProjectFixture("active");
    const purchase = await createPurchaseFixture(project);
    const canceledAt = new Date("2036-07-18T12:00:00.000Z");
    const ids = {
      futureDate: await createInstallment(purchase, {
        position: 1,
        dueAt: new Date("2036-07-19T12:00:00.000Z"),
      }),
      exactDue: await createInstallment(purchase, { position: 2, dueAt: canceledAt }),
      pastDue: await createInstallment(purchase, {
        position: 3,
        dueAt: new Date("2036-07-17T12:00:00.000Z"),
      }),
      untriggered: await createInstallment(purchase, { position: 4 }),
      acceptanceDue: await createInstallment(purchase, {
        position: 8,
        dueTrigger: "acceptance",
        dueAt: canceledAt,
      }),
      activationRequired: await createInstallment(purchase, {
        position: 9,
        requiredForActivation: true,
        dueAt: canceledAt,
      }),
      triggered: await createInstallment(purchase, {
        position: 5,
        triggeredAt: new Date("2036-07-18T10:00:00.000Z"),
        dueAt: canceledAt,
      }),
      partialFuture: await createInstallment(purchase, {
        position: 6,
        status: "partially_paid",
        dueAt: new Date("2036-07-19T12:00:00.000Z"),
      }),
      overdue: await createInstallment(purchase, {
        position: 7,
        status: "overdue",
        dueAt: new Date("2036-07-17T12:00:00.000Z"),
      }),
    };
    await createAllowance(purchase);
    await activeAdminDb().execute(sql`
      insert into ${sql.raw(qualifiedTestTable("purchase_payments"))}
        ("id", "purchase_id", "installment_id", "producer_id", "operation_key",
         "operation_digest", "source", "amount_cents", "currency", "paid_at",
         "added_by_clerk_user_id")
      values (${randomUUID()}, ${purchase.id}, ${ids.partialFuture}, ${purchase.producerId},
        ${`fixture-payment:${purchase.id}`}, ${`fixture-payment-digest:${purchase.id}`}, ${"manual"},
        ${1500}, ${"USD"}, ${new Date("2036-07-18T10:00:00.000Z")}, ${"fixture-actor"})
    `);
    await activeAdminDb().execute(sql`
      insert into ${sql.raw(qualifiedTestTable("purchase_waivers"))}
        ("id", "purchase_id", "installment_id", "producer_id", "operation_key",
         "operation_digest", "amount_cents", "reason", "waived_by_clerk_user_id")
      values (${randomUUID()}, ${purchase.id}, ${ids.overdue}, ${purchase.producerId},
        ${`fixture-waiver:${purchase.id}`}, ${`fixture-waiver-digest:${purchase.id}`}, ${250},
        ${"Manual waiver"}, ${"fixture-actor"})
    `);
    const beforeMoney = await moneyRows(project.id);

    const result = await cancelProject(projectLifecycleRepository(activeTransactionDb()), {
      producerId: project.producerId,
      projectId: project.id,
      actorId: "producer-user",
      reason: "Client stopped the work",
      canceledAt,
    });

    expect(result).toMatchObject({
      changed: true,
      canceledPurchaseIds: [purchase.id],
      canceledInstallments: 3,
      closedAllowances: 1,
    });
    expect((await storedProject(project.id))?.lifecycleStatus).toBe("canceled");
    expect((await storedPurchases(project.id))[0]?.lifecycleStatus).toBe("canceled");
    expect(await cancellationCount(project.id)).toBe(1);
    expect(await moneyRows(project.id)).toEqual(beforeMoney);

    const installments = new Map(
      (await storedInstallments(project.id)).map((row) => [row.id, row]),
    );
    for (const id of [ids.futureDate, ids.untriggered, ids.partialFuture]) {
      expect(installments.get(id)).toMatchObject({ status: "canceled", remindersEnabled: false });
    }
    for (const id of [ids.exactDue, ids.acceptanceDue, ids.activationRequired, ids.triggered]) {
      expect(installments.get(id)).toMatchObject({ status: "not_paid", remindersEnabled: true });
    }
    expect(installments.get(ids.pastDue)).toMatchObject({
      status: "overdue",
      remindersEnabled: true,
    });
    expect(installments.get(ids.overdue)).toMatchObject({
      status: "overdue",
      remindersEnabled: true,
    });
    const allowance = (await storedAllowances(project.id))[0];
    expect(allowance).toMatchObject({ closeReason: "project_canceled" });
    expect(time(allowance?.closedAt ?? null)).toBe(canceledAt.getTime());
  }, 30_000);

  it("cancels one purchase without changing the project or its sibling purchase", async () => {
    const project = await createProjectFixture("active");
    const target = await createPurchaseFixture(project);
    const sibling = await createPurchaseFixture(project);
    await createInstallment(target, { position: 1 });
    await createInstallment(sibling, { position: 1 });
    await createAllowance(target);
    await createAllowance(sibling);
    const beforeProject = await storedProject(project.id);
    const beforeSibling = (await storedPurchases(project.id)).find((row) => row.id === sibling.id);
    const canceledAt = new Date("2036-07-18T12:00:00.000Z");

    const result = await cancelProjectPurchase(projectLifecycleRepository(activeTransactionDb()), {
      producerId: project.producerId,
      projectId: project.id,
      purchaseId: target.id,
      actorId: "producer-user",
      reason: "Remove this add-on",
      canceledAt,
    });

    expect(result).toMatchObject({ changed: true, canceledInstallments: 1, closedAllowances: 1 });
    expect(await storedProject(project.id)).toEqual(beforeProject);
    const purchases = await storedPurchases(project.id);
    expect(purchases.find((row) => row.id === target.id)?.lifecycleStatus).toBe("canceled");
    expect(purchases.find((row) => row.id === sibling.id)).toEqual(beforeSibling);
    const installments = await storedInstallments(project.id);
    expect(installments.find((row) => row.purchaseId === target.id)?.status).toBe("canceled");
    expect(installments.find((row) => row.purchaseId === sibling.id)?.status).toBe("not_paid");
    const allowances = await storedAllowances(project.id);
    expect(allowances.find((row) => row.purchaseId === target.id)).toMatchObject({
      closeReason: "purchase_canceled",
    });
    expect(allowances.find((row) => row.purchaseId === sibling.id)?.closedAt).toBeNull();
    expect(await cancellationCount(project.id)).toBe(1);
  }, 30_000);

  it("reopens only the project and does not restore canceled child state", async () => {
    const project = await createProjectFixture("canceled");
    const purchase = await createPurchaseFixture(project, "canceled");
    const canceledAt = new Date("2036-07-18T09:00:00.000Z");
    await createInstallment(purchase, { position: 1, status: "canceled", remindersEnabled: false });
    await createAllowance(purchase, {
      closedAt: canceledAt,
      closeReason: "project_canceled",
    });
    await createCancellation(purchase, canceledAt);
    const beforePurchases = await storedPurchases(project.id);
    const beforeInstallments = await storedInstallments(project.id);
    const beforeAllowances = await storedAllowances(project.id);
    const reopenedAt = new Date("2036-07-18T14:00:00.000Z");

    const result = await reopenProject(projectLifecycleRepository(activeTransactionDb()), {
      producerId: project.producerId,
      projectId: project.id,
      reopenedAt,
    });

    expect(result).toMatchObject({ changed: true });
    expect((await storedProject(project.id))?.lifecycleStatus).toBe("active");
    expect(await storedPurchases(project.id)).toEqual(beforePurchases);
    expect(await storedInstallments(project.id)).toEqual(beforeInstallments);
    expect(await storedAllowances(project.id)).toEqual(beforeAllowances);
    expect(await cancellationCount(project.id)).toBe(1);
  }, 30_000);

  it("rejects reopening after the stable client has been archived", async () => {
    const project = await createProjectFixture("completed");
    const archivedAt = new Date("2036-07-18T13:00:00.000Z");

    await expect(
      archiveClient(clientManagementRepository(activeTransactionDb()), {
        producerId: project.producerId,
        clientId: project.clientContactId,
        archivedAt,
      }),
    ).resolves.toMatchObject({ changed: true });

    await expect(
      reopenProject(projectLifecycleRepository(activeTransactionDb()), {
        producerId: project.producerId,
        projectId: project.id,
        reopenedAt: new Date("2036-07-18T14:00:00.000Z"),
      }),
    ).rejects.toMatchObject({
      code: "INVALID_TRANSITION",
      message: PROJECT_REOPEN_ARCHIVED_CLIENT_MESSAGE,
    });
    expect((await storedProject(project.id))?.lifecycleStatus).toBe("completed");
    expect(time(await storedClientProducerArchivedAt(project.clientContactId))).toBe(
      archivedAt.getTime(),
    );
  }, 30_000);

  it("serializes client archival against reopening without an invalid final state", async () => {
    const project = await createProjectFixture("canceled");
    const archivedAt = new Date("2036-07-18T13:00:00.000Z");
    const results = await Promise.allSettled([
      reopenProject(projectLifecycleRepository(activeTransactionDb()), {
        producerId: project.producerId,
        projectId: project.id,
        reopenedAt: new Date("2036-07-18T14:00:00.000Z"),
      }),
      archiveClient(clientManagementRepository(activeTransactionDb()), {
        producerId: project.producerId,
        clientId: project.clientContactId,
        archivedAt,
      }),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    const stored = await storedProject(project.id);
    const storedArchivedAt = await storedClientProducerArchivedAt(project.clientContactId);
    if (stored?.lifecycleStatus === "active") {
      expect(storedArchivedAt).toBeNull();
      expect(results[1]).toMatchObject({
        status: "rejected",
        reason: { code: "BLOCKING_PROJECT" },
      });
    } else {
      expect(stored?.lifecycleStatus).toBe("canceled");
      expect(time(storedArchivedAt)).toBe(archivedAt.getTime());
      expect(results[0]).toMatchObject({
        status: "rejected",
        reason: {
          code: "INVALID_TRANSITION",
          message: PROJECT_REOPEN_ARCHIVED_CLIENT_MESSAGE,
        },
      });
    }
  }, 30_000);

  it("fails closed for every foreign producer lifecycle mutation", async () => {
    const project = await createProjectFixture("active");
    const purchase = await createPurchaseFixture(project);
    await createInstallment(purchase, { position: 1 });
    await createAllowance(purchase);
    const foreignProducerId = await createProducer();
    const before = {
      project: await storedProject(project.id),
      purchases: await storedPurchases(project.id),
      installments: await storedInstallments(project.id),
      allowances: await storedAllowances(project.id),
    };

    const operations = [
      () =>
        editProject(projectLifecycleRepository(activeTransactionDb()), {
          producerId: foreignProducerId,
          projectId: project.id,
          title: "Foreign edit",
          changedAt: new Date("2036-07-18T10:00:00.000Z"),
        }),
      () =>
        completeProject(projectLifecycleRepository(activeTransactionDb()), {
          producerId: foreignProducerId,
          projectId: project.id,
          completedAt: new Date("2036-07-18T11:00:00.000Z"),
        }),
      () =>
        cancelProject(projectLifecycleRepository(activeTransactionDb()), {
          producerId: foreignProducerId,
          projectId: project.id,
          actorId: "foreign-user",
          reason: "Foreign cancel",
          canceledAt: new Date("2036-07-18T12:00:00.000Z"),
        }),
      () =>
        reopenProject(projectLifecycleRepository(activeTransactionDb()), {
          producerId: foreignProducerId,
          projectId: project.id,
          reopenedAt: new Date("2036-07-18T13:00:00.000Z"),
        }),
      () =>
        cancelProjectPurchase(projectLifecycleRepository(activeTransactionDb()), {
          producerId: foreignProducerId,
          projectId: project.id,
          purchaseId: purchase.id,
          actorId: "foreign-user",
          reason: "Foreign purchase cancel",
          canceledAt: new Date("2036-07-18T14:00:00.000Z"),
        }),
    ];
    for (const operation of operations) {
      await expect(operation()).rejects.toMatchObject({ code: "NOT_FOUND" });
    }

    expect(await storedProject(project.id)).toEqual(before.project);
    expect(await storedPurchases(project.id)).toEqual(before.purchases);
    expect(await storedInstallments(project.id)).toEqual(before.installments);
    expect(await storedAllowances(project.id)).toEqual(before.allowances);
    expect(await cancellationCount(project.id)).toBe(0);
  }, 30_000);

  it("serializes competing terminal transitions without a mixed child state", async () => {
    const project = await createProjectFixture("active");
    const purchase = await createPurchaseFixture(project);
    await createInstallment(purchase, { position: 1 });
    await createAllowance(purchase);
    const changedAt = new Date("2036-07-18T12:00:00.000Z");
    const repository = projectLifecycleRepository(activeTransactionDb());

    const results = await Promise.allSettled([
      completeProject(repository, {
        producerId: project.producerId,
        projectId: project.id,
        completedAt: changedAt,
      }),
      cancelProject(repository, {
        producerId: project.producerId,
        projectId: project.id,
        actorId: "producer-user",
        reason: "Concurrent cancel",
        canceledAt: changedAt,
      }),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    const stored = await storedProject(project.id);
    const storedPurchase = (await storedPurchases(project.id))[0];
    const installment = (await storedInstallments(project.id))[0];
    const allowance = (await storedAllowances(project.id))[0];
    if (stored?.lifecycleStatus === "completed") {
      expect(storedPurchase?.lifecycleStatus).toBe("active");
      expect(installment?.status).toBe("not_paid");
      expect(allowance?.closeReason).toBe("project_completed");
      expect(await cancellationCount(project.id)).toBe(0);
    } else {
      expect(stored?.lifecycleStatus).toBe("canceled");
      expect(storedPurchase?.lifecycleStatus).toBe("canceled");
      expect(installment?.status).toBe("canceled");
      expect(allowance?.closeReason).toBe("project_canceled");
      expect(await cancellationCount(project.id)).toBe(1);
    }
  }, 30_000);

  it("deletes an empty draft and serializes deletion with history creation", async () => {
    const empty = await createProjectFixture("waiting_for_payment");
    await expect(
      permanentlyDeleteEmptyDraftProject(historicalDeletionRepository(activeTransactionDb()), {
        producerId: empty.producerId,
        projectId: empty.id,
      }),
    ).resolves.toEqual({ deleted: true });
    expect(await storedProject(empty.id)).toBeNull();

    const raced = await createProjectFixture("waiting_for_payment");
    const createHistory = () =>
      activeTransactionDb().transaction(async (tx) => {
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${projectAdvisoryLockKey(raced.id)}, 0))`,
        );
        const existing = await tx.execute<{ id: string }>(sql`
          select "id" from ${sql.raw(qualifiedTestTable("projects"))}
          where "id" = ${raced.id} and "producer_id" = ${raced.producerId}
          for update
        `);
        if (!existing.rows[0]) return "parent_missing" as const;
        await tx.execute(sql`
          insert into ${sql.raw(qualifiedTestTable("purchase_requests"))}
            ("id", "producer_id", "project_id")
          values (${randomUUID()}, ${raced.producerId}, ${raced.id})
        `);
        return "created" as const;
      });

    const [deletion, history] = await Promise.allSettled([
      permanentlyDeleteEmptyDraftProject(historicalDeletionRepository(activeTransactionDb()), {
        producerId: raced.producerId,
        projectId: raced.id,
      }),
      createHistory(),
    ]);

    expect(history.status).toBe("fulfilled");
    if (deletion.status === "fulfilled") {
      expect(history).toEqual({ status: "fulfilled", value: "parent_missing" });
      expect(await storedProject(raced.id)).toBeNull();
    } else {
      expect(deletion.reason).toMatchObject({ code: "HISTORY_EXISTS" });
      expect(history).toEqual({ status: "fulfilled", value: "created" });
      expect(await storedProject(raced.id)).not.toBeNull();
    }
  }, 30_000);
});
