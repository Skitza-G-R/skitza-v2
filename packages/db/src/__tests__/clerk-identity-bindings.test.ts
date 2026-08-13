import { readFileSync } from "node:fs";
import { join } from "node:path";

import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import {
  clerkIdentityBindings,
  clerkUserSyncReceipts,
  producerInvitationGrants,
  registeredAccounts,
} from "../schema";

const migration = readFileSync(
  join(process.cwd(), "drizzle/0051_clerk_identity_bindings.sql"),
  "utf8",
);

describe("SK-229 Clerk identity bindings", () => {
  it("keeps canonical and provider identity as separate schema fields", () => {
    expect(clerkIdentityBindings.providerClerkUserId.name).toBe("provider_clerk_user_id");
    expect(clerkIdentityBindings.canonicalClerkUserId.name).toBe("canonical_clerk_user_id");
    expect(registeredAccounts.providerClerkUserId.notNull).toBe(false);
    expect(registeredAccounts.clerkInstanceId.notNull).toBe(false);
    expect(clerkUserSyncReceipts.canonicalClerkUserId.notNull).toBe(true);
    expect(producerInvitationGrants.providerClerkUserId.notNull).toBe(true);
  });

  it("allows one active provider and canonical identity per instance", () => {
    const indexes = getTableConfig(clerkIdentityBindings).indexes.map((item) => item.config.name);
    expect(indexes).toContain("clerk_identity_bindings_provider_live_unique");
    expect(indexes).toContain("clerk_identity_bindings_canonical_active_unique");
    expect(migration).toContain("WHERE \"status\" IN ('staged', 'active')");
    expect(migration).toContain("WHERE \"status\" = 'active'");
  });

  it("makes evidence immutable and supports audited rejection before activation", () => {
    expect(migration).toContain('CREATE TRIGGER "clerk_identity_bindings_guard_mutation"');
    expect(migration).toContain("OLD.status = 'staged'");
    expect(migration).toContain("NEW.status = 'active'");
    expect(migration).toMatch(
      /OLD\.status = 'staged'[\s\S]*NEW\.status = 'revoked'[\s\S]*NEW\.activated_at IS NULL/,
    );
    expect(migration).toContain("OLD.status = 'active'");
    expect(migration).toContain("NEW.status = 'revoked'");
    expect(migration).toContain("clerk identity binding evidence is immutable");
    expect(migration).toContain("clerk relink bindings must be inserted staged");
    expect(migration).toContain("clerk provider identity ownership is immutable");
    expect(migration).toMatch(/status" = 'active'[\s\S]*"activated_at" IS NOT NULL/);
    expect(migration).toMatch(/status" = 'revoked'[\s\S]*"revoked_at" IS NOT NULL/);
    expect(migration).toMatch(/coalesce\("activated_at", "staged_at"\)[\s\S]*\) IS TRUE/);
  });

  it("keeps one registered-account canonical owner per provider tuple", () => {
    const indexes = getTableConfig(registeredAccounts).indexes.map((item) => item.config.name);
    expect(indexes).toContain("registered_accounts_provider_identity_unique");
    expect(migration).toContain(
      'CREATE UNIQUE INDEX "registered_accounts_provider_identity_unique"',
    );
  });

  it("never rewrites historical role or ownership identities", () => {
    expect(migration).not.toMatch(/UPDATE\s+"producers"/i);
    expect(migration).not.toMatch(/UPDATE\s+"client_contacts"/i);
    expect(migration).not.toMatch(/UPDATE\s+"account_closure/i);
  });

  it("backfills populated account rows only from their exact immutable receipt", () => {
    expect(migration).toMatch(
      /UPDATE "registered_accounts" AS account[\s\S]*receipt\."event_id" = account\."last_webhook_event_id"[\s\S]*receipt\."clerk_user_id" = account\."clerk_user_id"/,
    );
    expect(migration).toContain(
      "registered account lacks exact Clerk webhook receipt for identity backfill",
    );
    const backfill = migration.indexOf('UPDATE "registered_accounts" AS account');
    const constraint = migration.indexOf('ADD CONSTRAINT "registered_accounts_sync_shape"');
    expect(backfill).toBeGreaterThan(-1);
    expect(constraint).toBeGreaterThan(backfill);
  });
});
