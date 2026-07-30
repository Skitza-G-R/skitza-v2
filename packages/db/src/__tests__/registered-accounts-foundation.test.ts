import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { clerkUserSyncReceipts, registeredAccounts } from "../schema";

const migrationPath = fileURLToPath(
  new URL("../../drizzle/0037_registered_accounts.sql", import.meta.url),
);

describe("registered account foundation", () => {
  it("keeps the Drizzle schema aligned with one Clerk-keyed account row", () => {
    expect(registeredAccounts.clerkUserId.name).toBe("clerk_user_id");
    expect(registeredAccounts.providerState.name).toBe("provider_state");
    expect(registeredAccounts.providerUpdatedAt.name).toBe("provider_updated_at");
    expect(registeredAccounts.lastSignInAt.name).toBe("last_sign_in_at");
    expect(registeredAccounts.audienceType.name).toBe("audience_type");
    expect(clerkUserSyncReceipts.eventId.name).toBe("event_id");
  });

  it("adds only registered identities and labels legacy mappings as needing sync", () => {
    const migration = readFileSync(migrationPath, "utf8");

    expect(migration).toContain('CREATE TABLE "registered_accounts"');
    expect(migration).toContain('"clerk_user_id" text PRIMARY KEY');
    expect(migration).toContain("'needs_sync'");
    expect(migration).toMatch(
      /FROM "client_contacts"[\s\S]*WHERE "clerk_user_id" IS NOT NULL/,
    );
    expect(migration).not.toMatch(/lower\(btrim\("email"\)\)/);
    expect(migration).toMatch(
      /INSERT INTO "registered_accounts" \(\s*"clerk_user_id"\s*\)\s*SELECT\s*"clerk_user_id"\s*FROM "producers"/,
    );
  });

  it("forces deleted rows to keep no copied identity content", () => {
    const migration = readFileSync(migrationPath, "utf8");

    expect(migration).toContain("registered_accounts_deleted_pii_shape");
    expect(migration).toMatch(
      /"provider_state" <> 'deleted'[\s\S]*"primary_email" IS NULL[\s\S]*"display_name" IS NULL[\s\S]*"email_verified" IS NULL[\s\S]*"audience_type" = 'unknown'[\s\S]*"last_sign_in_at" IS NULL/,
    );
    expect(migration).toContain(
      'CREATE TRIGGER "registered_accounts_terminal_tombstone"',
    );
    expect(migration).toMatch(
      /OLD\."provider_state" = 'deleted'[\s\S]*NEW\."provider_state" <> 'deleted'[\s\S]*SKITZA_REGISTERED_ACCOUNT_TOMBSTONE_TERMINAL/,
    );
    expect(migration).toContain("RETURN NEW;");
  });

  it("does not invent an ordering between Clerk update and last sign-in", () => {
    const migration = readFileSync(migrationPath, "utf8");

    expect(migration).not.toMatch(
      /"last_sign_in_at"\s*<=\s*"provider_updated_at"/,
    );
  });

  it("adds append-only signed webhook receipts with instance and digest binding", () => {
    const migration = readFileSync(migrationPath, "utf8");

    expect(migration).toContain('CREATE TABLE "clerk_user_sync_receipts"');
    expect(migration).toContain('"event_digest" ~ \'^sha256:[0-9a-f]{64}$\'');
    expect(migration).toContain('"clerk_instance_id"');
    expect(migration).toContain("clerk_user_sync_receipts_append_only");
    expect(migration).toContain('EXECUTE FUNCTION "prevent_append_only_mutation"()');
  });

  it("indexes provider state, signup, activity, and normalized search fields", () => {
    const migration = readFileSync(migrationPath, "utf8");

    for (const name of [
      "registered_accounts_provider_state_idx",
      "registered_accounts_provider_created_idx",
      "registered_accounts_email_search_idx",
      "registered_accounts_name_search_idx",
      "registered_accounts_clerk_id_search_idx",
      "producers_admin_email_search_idx",
      "producers_admin_name_search_idx",
      "client_contacts_admin_email_search_idx",
      "client_contacts_admin_name_search_idx",
      "client_contacts_active_clerk_user_idx",
      "purchase_requests_admin_activation_idx",
      "purchases_admin_activation_idx",
      "bookings_admin_activation_idx",
      "projects_admin_client_activity_idx",
      "purchase_requests_admin_client_activity_idx",
      "payment_proofs_admin_client_activity_idx",
      "admin_action_history_target_account_occurred_idx",
    ]) {
      expect(migration).toContain(name);
    }
    expect(migration).toContain("text_pattern_ops");
    expect(migration).toContain('"provider_created_at" DESC NULLS LAST');
    expect(migration).toContain(
      'CASE WHEN "provider_created_at" IS NULL THEN 1 ELSE 0 END',
    );
    expect(migration).toContain('WHERE "provider_state" <> \'deleted\'');
    expect(migration).toContain(
      'WHERE "target_account_clerk_user_id" IS NOT NULL',
    );
  });
});
