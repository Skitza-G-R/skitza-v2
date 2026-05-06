import { randomUUID } from "node:crypto";
import { describe, it, expect, afterAll } from "vitest";
import { eq, inArray } from "drizzle-orm";
import {
  createDb,
  producers,
  portfolioTracks,
} from "../index";

const url = process.env.DATABASE_URL_TEST;
const describeIfDb = url ? describe : describe.skip;

describeIfDb("Extended tables (portfolio_tracks)", () => {
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

  it("cascades deletion from producer through portfolio_tracks", async () => {
    const producerId = await makeProducer();

    const [track] = await db!
      .insert(portfolioTracks)
      .values({
        producerId,
        title: "Test Track",
        audioUrl: "https://example.com/track.mp3",
      })
      .returning();

    // Sanity: all rows exist before delete
    expect(track!.id).toBeDefined();

    // Cascade delete via producer
    await db!.delete(producers).where(eq(producers.id, producerId));

    const remainingTracks = await db!
      .select()
      .from(portfolioTracks)
      .where(eq(portfolioTracks.id, track!.id));

    expect(remainingTracks).toHaveLength(0);

    // Already deleted; remove from the cleanup list so afterAll doesn't no-op error.
    const idx = createdProducerIds.indexOf(producerId);
    if (idx >= 0) createdProducerIds.splice(idx, 1);
  });
});
