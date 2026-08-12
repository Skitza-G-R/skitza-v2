import { readFileSync } from "node:fs";
import { join } from "node:path";

import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import { producerInvitationGrants } from "../schema";

const migration = readFileSync(
  join(process.cwd(), "drizzle/0049_producer_invitation_grants.sql"),
  "utf8",
);
const config = getTableConfig(producerInvitationGrants);

describe("SK-229 Producer invitation grants", () => {
  it("stores one immutable Clerk invitation claim per Producer account", () => {
    expect(producerInvitationGrants.clerkInvitationId.name).toBe(
      "clerk_invitation_id",
    );
    expect(producerInvitationGrants.clerkInvitationId.notNull).toBe(true);
    expect(producerInvitationGrants.clerkUserId.notNull).toBe(true);
    expect(producerInvitationGrants.clerkInstanceId.notNull).toBe(true);
    expect(producerInvitationGrants.invitedEmailHash.notNull).toBe(true);
    expect(producerInvitationGrants.invitationCreatedAt.notNull).toBe(true);
    expect(producerInvitationGrants.providerUpdatedAt.notNull).toBe(true);
    expect(producerInvitationGrants.grantedAt.notNull).toBe(true);

    expect(migration).toContain('CREATE TABLE "producer_invitation_grants"');
    expect(migration).toContain('"clerk_invitation_id" text PRIMARY KEY');
    expect(config.uniqueConstraints.map((constraint) => constraint.name)).toContain(
      "producer_invitation_grants_clerk_user_unique",
    );
  });

  it("binds the grant to exact provider and verified-email identities", () => {
    expect(config.checks.map((constraint) => constraint.name)).toEqual(
      expect.arrayContaining([
        "producer_invitation_grants_identity_shape",
        "producer_invitation_grants_timestamp_shape",
      ]),
    );
    expect(migration).toContain(
      '"invited_email_hash" ~ \'^[0-9a-f]{64}$\'',
    );
    expect(migration).toContain(
      '"provider_updated_at" >= "invitation_created_at"',
    );
    expect(migration).not.toContain('"invited_email" text');
  });

  it("keeps authorization receipts append-only and independent of webhook timing", () => {
    expect(config.foreignKeys).toHaveLength(0);
    expect(migration).toMatch(
      /CREATE TRIGGER "producer_invitation_grants_append_only"[\s\S]*BEFORE UPDATE OR DELETE ON "producer_invitation_grants"[\s\S]*EXECUTE FUNCTION "prevent_append_only_mutation"\(\)/,
    );
    expect(migration).not.toMatch(/\b(?:UPDATE|DELETE FROM)\s+"producer_invitation_grants"/i);
  });
});
