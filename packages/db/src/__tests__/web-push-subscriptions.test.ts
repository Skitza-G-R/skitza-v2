import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import * as schema from "../schema";

const migration = readFileSync(
  join(process.cwd(), "drizzle/0035_web_push_subscriptions.sql"),
  "utf8",
);

describe("SK-112 Web Push subscription schema", () => {
  it("stores multiple account-owned devices with a globally unique endpoint digest", () => {
    expect(schema.pushSubscriptions.clerkUserId.notNull).toBe(true);
    expect(schema.pushSubscriptions.endpoint.notNull).toBe(true);
    expect(schema.pushSubscriptions.endpointHash.notNull).toBe(true);
    expect(Object.keys(schema.pushSubscriptions)).toEqual(
      expect.arrayContaining([
        "id",
        "clerkUserId",
        "endpoint",
        "endpointHash",
        "p256dh",
        "auth",
        "categories",
        "expiresAt",
        "createdAt",
        "updatedAt",
      ]),
    );
    expect(migration).toMatch(
      /CONSTRAINT "push_subscriptions_endpoint_hash_unique" UNIQUE \("endpoint_hash"\)/,
    );
    expect(migration).not.toMatch(/UNIQUE \("clerk_user_id"\)/);
  });

  it("defaults every real category off and rejects invented categories", () => {
    expect(migration).toMatch(/"categories" text\[\] DEFAULT '\{\}'::text\[\] NOT NULL/);
    for (const category of [
      "booking",
      "payment",
      "comment",
      "project_status",
      "song_status",
      "purchase_status",
    ]) {
      expect(migration).toContain(`'${category}'`);
    }
    expect(migration).not.toMatch(/weekly|overdue|approval|message|marketing/);
    expect(migration).toContain("push_subscriptions_categories_allowlist");
  });

  it("supports expiry pruning without weakening endpoint and key validation", () => {
    expect(migration).toContain("push_subscriptions_expires_idx");
    expect(migration).toMatch(/WHERE "expires_at" IS NOT NULL/);
    expect(migration).toContain("push_subscriptions_endpoint_https");
    expect(migration).toContain("^sha256:[0-9a-f]{64}$");
    expect(migration).toContain("push_subscriptions_key_shape");
  });

  it("is additive and leaves all existing account and product rows untouched", () => {
    expect(migration).not.toMatch(
      /\b(?:ALTER TABLE|UPDATE|DELETE FROM|TRUNCATE|DROP TABLE|DROP COLUMN)\b/i,
    );
    expect(migration).toMatch(/^--[\s\S]*CREATE TABLE "push_subscriptions"/);
    expect(migration).not.toContain("IF NOT EXISTS");
  });
});
