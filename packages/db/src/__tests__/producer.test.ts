import { describe, it, expect, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { createDb, producers } from "../index";

const url = process.env.DATABASE_URL_TEST;
const describeIfDb = url ? describe : describe.skip;

describeIfDb("Producer table", () => {
  const testClerkId = `test_${Date.now()}`;
  const db = url ? createDb(url) : null;

  afterAll(async () => {
    if (!db) return;
    await db.delete(producers).where(eq(producers.clerkUserId, testClerkId));
  });

  it("inserts and reads a Producer", async () => {
    const [inserted] = await db!
      .insert(producers)
      .values({ clerkUserId: testClerkId, email: "test@example.com", slug: testClerkId })
      .returning();
    expect(inserted!.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(inserted!.defaultCurrency).toBe("USD");

    const [found] = await db!
      .select()
      .from(producers)
      .where(eq(producers.clerkUserId, testClerkId));
    expect(found!.email).toBe("test@example.com");
  });
});
