import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { getTableConfig } from "drizzle-orm/pg-core";
import { privateOffers } from "../schema";

const migration = readFileSync(
  join(process.cwd(), "drizzle/0029_private_offer_recipient_identity.sql"),
  "utf8",
);

describe("SK-96 private-offer recipient identity", () => {
  it("stores the normalized invited email and hash on the offer", () => {
    expect(privateOffers.recipientEmail.notNull).toBe(true);
    expect(privateOffers.recipientEmailHash.notNull).toBe(true);
    expect(getTableConfig(privateOffers).checks.map((check) => check.name)).toContain(
      "private_offers_recipient_email_hash_shape",
    );
  });

  it("backfills existing offers and freezes recipient identity", () => {
    expect(migration).toContain("SKITZA_PRIVATE_OFFER_RECIPIENT_BACKFILL_FAILED");
    expect(migration).toContain("private_offers_recipient_identity_immutable");
    expect(migration).toContain("SKITZA_PRIVATE_OFFER_RECIPIENT_IMMUTABLE");
  });
});
