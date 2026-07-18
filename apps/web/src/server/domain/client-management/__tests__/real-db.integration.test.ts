import { randomUUID } from "node:crypto";

import {
  and,
  clientContacts,
  createDb,
  eq,
  inArray,
  producers,
  projects,
} from "@skitza/db";
import { afterAll, describe, expect, it, vi } from "vitest";

import { emailHashFor } from "~/server/artist/identity";
import { clientManagementRepository } from "../db";
import { archiveClient, editClient, inviteClient } from "../service";
import { historicalDeletionRepository } from "../../history-deletion/db";
import { permanentlyDeleteEmptyDraftClient } from "../../history-deletion/service";
import { stableProjectRepository } from "../../project-ownership/db";
import { createStableClientProject } from "../../project-ownership/service";

const testDatabaseUrl = process.env.DATABASE_URL_TEST;
const describeWithTestDatabase = testDatabaseUrl ? describe : describe.skip;

describeWithTestDatabase("SK-93 client management — separate CI test database", () => {
  const db = testDatabaseUrl ? createDb(testDatabaseUrl) : null;
  const createdProducerIds: string[] = [];

  function activeDb() {
    if (!db) throw new Error("SK-93 test database is unavailable");
    return db;
  }

  async function createProducer(): Promise<string> {
    const key = `sk93_${randomUUID()}`;
    const [producer] = await activeDb()
      .insert(producers)
      .values({
        clerkUserId: key,
        email: `${key}@example.test`,
        slug: key,
      })
      .returning({ id: producers.id });
    if (!producer) throw new Error("SK-93 test producer was not created");
    createdProducerIds.push(producer.id);
    return producer.id;
  }

  async function createClient(producerId: string, label: string) {
    const emailLabel = label.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    const email = `${emailLabel}-${randomUUID()}@example.test`;
    const [client] = await activeDb()
      .insert(clientContacts)
      .values({
        producerId,
        name: label,
        email,
        emailHash: emailHashFor(email),
      })
      .returning();
    if (!client) throw new Error("SK-93 test client was not created");
    return client;
  }

  afterAll(async () => {
    if (createdProducerIds.length === 0) return;
    await activeDb().delete(projects).where(inArray(projects.producerId, createdProducerIds));
    await activeDb().delete(producers).where(inArray(producers.id, createdProducerIds));
  });

  it("allows exactly one concurrent winner for a producer-scoped email", async () => {
    const producerId = await createProducer();
    const [first, second] = await Promise.all([
      createClient(producerId, "Email race A"),
      createClient(producerId, "Email race B"),
    ]);
    const targetEmail = `winner-${randomUUID()}@example.test`;
    const repository = clientManagementRepository(activeDb());

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
    const matching = await activeDb()
      .select({ id: clientContacts.id })
      .from(clientContacts)
      .where(
        and(
          eq(clientContacts.producerId, producerId),
          eq(clientContacts.emailHash, emailHashFor(targetEmail)),
        ),
      );
    expect(matching).toHaveLength(1);
  });

  it("serializes project creation with archive so only one state transition wins", async () => {
    const producerId = await createProducer();
    const client = await createClient(producerId, "Archive race");

    const results = await Promise.allSettled([
      archiveClient(clientManagementRepository(activeDb()), {
        producerId,
        clientId: client.id,
        archivedAt: new Date("2036-07-18T12:00:00.000Z"),
      }),
      createStableClientProject(stableProjectRepository(activeDb()), {
        producerId,
        clientContactId: client.id,
        title: "SK-93 archive race",
        inviteToken: `sk93-${randomUUID()}`,
        deadlineAt: null,
      }),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);

    const [storedClient] = await activeDb()
      .select({ producerArchivedAt: clientContacts.producerArchivedAt })
      .from(clientContacts)
      .where(eq(clientContacts.id, client.id));
    const storedProjects = await activeDb()
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.clientContactId, client.id));
    expect(
      (storedClient?.producerArchivedAt === null && storedProjects.length === 1) ||
        (storedClient?.producerArchivedAt instanceof Date && storedProjects.length === 0),
    ).toBe(true);
  });

  it("never delivers an invite for a concurrently deleted empty draft", async () => {
    const producerId = await createProducer();
    const client = await createClient(producerId, "Invite delete race");
    const deliverEmail = vi.fn(() => Promise.resolve());

    const results = await Promise.allSettled([
      inviteClient(clientManagementRepository(activeDb()), {
        producerId,
        clientId: client.id,
        via: "email",
        invitedAt: new Date("2036-07-18T12:00:00.000Z"),
        deliverEmail,
      }),
      permanentlyDeleteEmptyDraftClient(historicalDeletionRepository(activeDb()), {
        producerId,
        clientId: client.id,
      }),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);

    const remaining = await activeDb()
      .select({ invitedAt: clientContacts.invitedAt })
      .from(clientContacts)
      .where(eq(clientContacts.id, client.id));
    if (results[0].status === "fulfilled") {
      expect(deliverEmail).toHaveBeenCalledTimes(1);
      expect(remaining).toHaveLength(1);
      expect(remaining[0]?.invitedAt).toBeInstanceOf(Date);
    } else {
      expect(deliverEmail).not.toHaveBeenCalled();
      expect(remaining).toHaveLength(0);
    }
  });

  it("permanently deletes a genuinely empty client with no history", async () => {
    const producerId = await createProducer();
    const client = await createClient(producerId, "Empty draft");

    await expect(
      permanentlyDeleteEmptyDraftClient(historicalDeletionRepository(activeDb()), {
        producerId,
        clientId: client.id,
      }),
    ).resolves.toEqual({ deleted: true });

    const remaining = await activeDb()
      .select({ id: clientContacts.id })
      .from(clientContacts)
      .where(eq(clientContacts.id, client.id));
    expect(remaining).toHaveLength(0);
  });
});
