import { randomUUID } from "node:crypto";
import { describe, it, expect, afterAll } from "vitest";
import { eq, inArray } from "drizzle-orm";
import {
  createDb,
  producers,
  leads,
  magicLinks,
  magicLinkViews,
  portfolioTracks,
} from "../index";

const url = process.env.DATABASE_URL_TEST;
const describeIfDb = url ? describe : describe.skip;

describeIfDb("Extended tables (leads, magic_links, magic_link_views, portfolio_tracks)", () => {
  const db = url ? createDb(url) : null;
  // Track every producer this suite creates so afterAll can cascade-clean them
  // even if an `it` block aborts mid-flight.
  const createdProducerIds: string[] = [];

  async function makeProducer(): Promise<string> {
    const key = `test_${randomUUID()}`;
    const [row] = await db!
      .insert(producers)
      .values({ clerkUserId: key, email: `${key}@example.com`, slug: key })
      .returning();
    createdProducerIds.push(row!.id);
    return row!.id;
  }

  afterAll(async () => {
    if (!db || createdProducerIds.length === 0) return;
    await db.delete(producers).where(inArray(producers.id, createdProducerIds));
  });

  it("cascades deletion from producer through leads, magic_links, magic_link_views, portfolio_tracks", async () => {
    const producerId = await makeProducer();

    const [lead] = await db!
      .insert(leads)
      .values({ producerId, name: "Test Lead", email: "lead@example.com" })
      .returning();

    const [link] = await db!
      .insert(magicLinks)
      .values({
        producerId,
        leadId: lead!.id,
        target: "portfolio",
        tokenHash: `hash_${randomUUID()}`,
        expiresAt: new Date(Date.now() + 60_000),
      })
      .returning();

    const [view] = await db!
      .insert(magicLinkViews)
      .values({ magicLinkId: link!.id, ip: "127.0.0.1", userAgent: "test" })
      .returning();

    const [track] = await db!
      .insert(portfolioTracks)
      .values({
        producerId,
        title: "Test Track",
        audioUrl: "https://example.com/track.mp3",
      })
      .returning();

    // Sanity: all rows exist before delete
    expect(lead!.id).toBeDefined();
    expect(link!.id).toBeDefined();
    expect(view!.id).toBeDefined();
    expect(track!.id).toBeDefined();

    // Cascade delete via producer
    await db!.delete(producers).where(eq(producers.id, producerId));

    const remainingLeads = await db!.select().from(leads).where(eq(leads.id, lead!.id));
    const remainingLinks = await db!
      .select()
      .from(magicLinks)
      .where(eq(magicLinks.id, link!.id));
    const remainingViews = await db!
      .select()
      .from(magicLinkViews)
      .where(eq(magicLinkViews.id, view!.id));
    const remainingTracks = await db!
      .select()
      .from(portfolioTracks)
      .where(eq(portfolioTracks.id, track!.id));

    expect(remainingLeads).toHaveLength(0);
    expect(remainingLinks).toHaveLength(0);
    // View cascades through magic_links -> producer
    expect(remainingViews).toHaveLength(0);
    expect(remainingTracks).toHaveLength(0);

    // Already deleted; remove from the cleanup list so afterAll doesn't no-op error.
    const idx = createdProducerIds.indexOf(producerId);
    if (idx >= 0) createdProducerIds.splice(idx, 1);
  });

  it("sets magic_links.lead_id to null when the referenced lead is deleted", async () => {
    const producerId = await makeProducer();

    const [lead] = await db!
      .insert(leads)
      .values({ producerId, name: "Soon-to-be-deleted Lead" })
      .returning();

    const [link] = await db!
      .insert(magicLinks)
      .values({
        producerId,
        leadId: lead!.id,
        target: "booking",
        tokenHash: `hash_${randomUUID()}`,
        expiresAt: new Date(Date.now() + 60_000),
      })
      .returning();

    expect(link!.leadId).toBe(lead!.id);

    await db!.delete(leads).where(eq(leads.id, lead!.id));

    const [refetched] = await db!
      .select()
      .from(magicLinks)
      .where(eq(magicLinks.id, link!.id));

    // Magic link must persist (analytics history) but lose its lead reference
    expect(refetched).toBeDefined();
    expect(refetched!.leadId).toBeNull();
  });

  it("rejects duplicate magic_links.token_hash with a UNIQUE violation", async () => {
    const producerA = await makeProducer();
    const producerB = await makeProducer();
    const sharedHash = `hash_${randomUUID()}`;

    await db!.insert(magicLinks).values({
      producerId: producerA,
      target: "portfolio",
      tokenHash: sharedHash,
      expiresAt: new Date(Date.now() + 60_000),
    });

    await expect(
      db!.insert(magicLinks).values({
        producerId: producerB,
        target: "portfolio",
        tokenHash: sharedHash,
        expiresAt: new Date(Date.now() + 60_000),
      }),
    ).rejects.toThrow(/duplicate key|unique/i);
  });
});
