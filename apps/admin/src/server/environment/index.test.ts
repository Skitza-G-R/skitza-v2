import { describe, expect, it } from "vitest";

import {
  ADMIN_LIVE_DATABASE_URL_ENV,
  AdminEnvironmentConfigurationError,
  getAdminEnvironmentPublicContext,
  resolveAdminEnvironment,
  type AdminEnvironmentMap,
} from ".";

// SK-288 — one environment. The selector, the Test binding and the
// live-versus-test collision check are gone; every guard that protected the
// single live binding stays.

const LIVE_DATABASE_URL = "postgresql://live.example.test/skitza";

function exactEnvironment(overrides: AdminEnvironmentMap = {}): AdminEnvironmentMap {
  return { [ADMIN_LIVE_DATABASE_URL_ENV]: LIVE_DATABASE_URL, ...overrides };
}

describe("admin environment", () => {
  it("requires the live database binding", () => {
    expect(() =>
      resolveAdminEnvironment({
        [ADMIN_LIVE_DATABASE_URL_ENV]: " ",
        DATABASE_URL: "postgresql://generic.example.test/skitza",
      }),
    ).toThrow(expect.objectContaining({ code: "ADMIN_ENVIRONMENT_BINDING_MISSING" }));
  });

  it("never infers a binding from Vercel or generic variables", () => {
    expect(() =>
      resolveAdminEnvironment({
        DATABASE_URL: "postgresql://generic.example.test/skitza",
        VERCEL_ENV: "production",
      }),
    ).toThrow(expect.objectContaining({ code: "ADMIN_ENVIRONMENT_BINDING_MISSING" }));
  });

  it("ignores a leftover Test binding instead of demanding one", () => {
    // The Test environment is gone. A stale ADMIN_TEST_DATABASE_URL left in
    // the deployment must neither be required nor ever be connected to.
    const resolved = resolveAdminEnvironment(
      exactEnvironment({ ADMIN_TEST_DATABASE_URL: "postgresql://test.example.test/skitza" }),
    );

    expect(resolved.databaseUrl).toBe(LIVE_DATABASE_URL);
  });

  it("accepts the live and test bindings pointing at one database", () => {
    // The old resolver refused to start when both bindings named the same
    // target. With one environment that is no longer a conflict.
    expect(
      resolveAdminEnvironment(exactEnvironment({ ADMIN_TEST_DATABASE_URL: LIVE_DATABASE_URL }))
        .databaseUrl,
    ).toBe(LIVE_DATABASE_URL);
  });

  it("rejects malformed and non-Postgres bindings without echoing them", () => {
    for (const invalidBinding of [
      "not-a-database-url",
      "https://database.example.test/skitza",
      "postgresql://database.example.test/",
    ]) {
      let error: unknown;
      try {
        resolveAdminEnvironment(
          exactEnvironment({ [ADMIN_LIVE_DATABASE_URL_ENV]: invalidBinding }),
        );
      } catch (caught) {
        error = caught;
      }

      expect(error).toMatchObject({ code: "ADMIN_ENVIRONMENT_BINDING_INVALID" });
      expect(String(error)).not.toContain(invalidBinding);
    }
  });

  it("resolves the live server binding", () => {
    expect(resolveAdminEnvironment(exactEnvironment())).toEqual({
      databaseUrl: LIVE_DATABASE_URL,
      publicContext: { id: "live", label: "Live", tone: "danger" },
    });
  });

  it("exposes a public context with only id, label, and tone", () => {
    const context = getAdminEnvironmentPublicContext();

    expect(Object.keys(context).sort()).toEqual(["id", "label", "tone"]);
    expect(JSON.stringify(context)).not.toContain("postgresql://");
    expect(JSON.stringify(context)).not.toContain("DATABASE_URL");
  });

  it("does not copy private bindings into errors", () => {
    const privateValue = "do-not-expose-private-database-binding";
    let error: unknown;

    try {
      resolveAdminEnvironment(exactEnvironment({ [ADMIN_LIVE_DATABASE_URL_ENV]: privateValue }));
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(AdminEnvironmentConfigurationError);
    expect(String(error)).not.toContain(privateValue);
  });
});
