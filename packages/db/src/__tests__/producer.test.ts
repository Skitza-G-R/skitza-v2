import { randomUUID } from "node:crypto";
import { describe, it, expect, afterAll } from "vitest";
import { eq, sql } from "drizzle-orm";
import { createDb, producers } from "../index";

const url = process.env.DATABASE_URL_TEST;
const describeIfDb = url ? describe : describe.skip;

describeIfDb("Producer table", () => {
  // randomUUID (not Date.now) so parallel CI workers can't collide on the
  // clerk_user_id UNIQUE constraint and surface as duplicate-key errors.
  const testClerkId = `test_${randomUUID()}`;
  const db = url ? createDb(url) : null;

  afterAll(async () => {
    if (!db) return;
    await db.delete(producers).where(eq(producers.clerkUserId, testClerkId));
  });

  it("inserts and reads a Producer", async () => {
    const result = await db!.execute<{ id: string; default_currency: string }>(sql`
      INSERT INTO producers (clerk_user_id, email, slug)
      VALUES (${testClerkId}, ${"test@example.com"}, ${testClerkId})
      RETURNING id, default_currency
    `);
    const inserted = result.rows[0];
    expect(inserted!.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(inserted!.default_currency).toBe("USD");

    const [found] = await db!
      .select({ email: producers.email })
      .from(producers)
      .where(eq(producers.clerkUserId, testClerkId));
    expect(found!.email).toBe("test@example.com");
  });
});
