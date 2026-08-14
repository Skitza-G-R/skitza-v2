import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { getTableConfig, type PgTable } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import { desktopAuthCodes } from "../schema";

const migrationPath = fileURLToPath(
  new URL("../../drizzle/0050_desktop_auth_codes.sql", import.meta.url),
);

function config(table: PgTable) {
  return getTableConfig(table);
}

describe("SK-232 desktop authorization-code schema", () => {
  it("stores only a producer-bound digest and S256 challenge for sixty seconds", () => {
    const table = config(desktopAuthCodes);
    const columnNames = Object.values(table.columns).map((column) => column.name);

    expect(desktopAuthCodes.codeDigest.notNull).toBe(true);
    expect(desktopAuthCodes.stateDigest.notNull).toBe(true);
    expect(desktopAuthCodes.producerId.notNull).toBe(true);
    expect(desktopAuthCodes.pkceChallenge.notNull).toBe(true);
    expect(desktopAuthCodes.expiresAt.notNull).toBe(true);
    expect(desktopAuthCodes.consumedAt.notNull).toBe(false);
    expect(columnNames).not.toEqual(
      expect.arrayContaining([
        "authorization_code",
        "code_verifier",
        "state",
        "ticket",
        "session_token",
      ]),
    );
    expect(table.uniqueConstraints.map((entry) => entry.name)).toContain(
      "desktop_auth_codes_code_digest_unique",
    );
    expect(table.indexes.map((entry) => entry.config.name)).toContain(
      "desktop_auth_codes_expires_idx",
    );
    expect(table.foreignKeys.map((entry) => entry.getName())).toContain(
      "desktop_auth_codes_producer_fk",
    );
    expect(table.checks.map((entry) => entry.name)).toEqual(
      expect.arrayContaining([
        "desktop_auth_codes_code_digest_shape",
        "desktop_auth_codes_state_digest_shape",
        "desktop_auth_codes_pkce_challenge_shape",
        "desktop_auth_codes_lifetime_shape",
      ]),
    );
  });

  it("makes exchange single-use and keeps every handoff secret out of SQL", () => {
    const migration = readFileSync(migrationPath, "utf8");

    expect(migration).toContain("interval '60 seconds'");
    expect(migration).toContain('OLD."consumed_at" IS NOT NULL');
    expect(migration).toContain('NEW."consumed_at" IS NULL');
    expect(migration).toContain("SKITZA_DESKTOP_AUTH_CODE_IMMUTABLE_OR_CONSUMED");
    expect(migration).toContain("desktop_auth_codes_consume_once");
    expect(migration).not.toMatch(
      /"(?:authorization_code|code_verifier|state|ticket|session_token)"\s+/i,
    );
  });
});
