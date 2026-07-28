import { describe, expect, it } from "vitest";

import {
  ADMIN_DATABASE_ENV_NAMES,
  AdminEnvironmentConfigurationError,
  getAdminEnvironmentPublicContext,
  parseAdminEnvironmentId,
  resolveAdminEnvironment,
  type AdminEnvironmentMap,
} from ".";

const LIVE_DATABASE_URL = "postgresql://live.example.test/skitza";
const TEST_DATABASE_URL = "postgresql://test.example.test/skitza";

function exactEnvironment(
  overrides: AdminEnvironmentMap = {},
): AdminEnvironmentMap {
  return {
    [ADMIN_DATABASE_ENV_NAMES.live]: LIVE_DATABASE_URL,
    [ADMIN_DATABASE_ENV_NAMES.test]: TEST_DATABASE_URL,
    ...overrides,
  };
}

describe("admin environment selection", () => {
  it("accepts exactly live and test", () => {
    expect(parseAdminEnvironmentId("live")).toBe("live");
    expect(parseAdminEnvironmentId("test")).toBe("test");

    for (const invalid of [
      undefined,
      "",
      "LIVE",
      "TEST",
      " live",
      "test ",
      "preview",
      "production",
    ]) {
      expect(() => parseAdminEnvironmentId(invalid), String(invalid)).toThrow(
        expect.objectContaining({ code: "ADMIN_ENVIRONMENT_INVALID" }),
      );
    }
  });

  it("requires both dedicated database bindings", () => {
    for (const missingName of Object.values(ADMIN_DATABASE_ENV_NAMES)) {
      const environment = {
        ...exactEnvironment(),
        [missingName]: " ",
        DATABASE_URL: "postgresql://generic.example.test/skitza",
      };

      expect(() => resolveAdminEnvironment(environment, "test")).toThrow(
        expect.objectContaining({
          code: "ADMIN_ENVIRONMENT_BINDING_MISSING",
        }),
      );
    }
  });

  it("never infers the selector or a binding from Vercel and generic variables", () => {
    const genericOnly = {
      DATABASE_URL: "postgresql://generic.example.test/skitza",
      VERCEL_ENV: "live",
    };

    expect(() => resolveAdminEnvironment(genericOnly, undefined)).toThrow(
      expect.objectContaining({ code: "ADMIN_ENVIRONMENT_INVALID" }),
    );
    expect(() => resolveAdminEnvironment(genericOnly, "live")).toThrow(
      expect.objectContaining({
        code: "ADMIN_ENVIRONMENT_BINDING_MISSING",
      }),
    );
  });

  it("rejects identical Live and Test bindings", () => {
    const environment = exactEnvironment({
      [ADMIN_DATABASE_ENV_NAMES.test]: ` ${LIVE_DATABASE_URL} `,
    });

    expect(() => resolveAdminEnvironment(environment, "live")).toThrow(
      expect.objectContaining({
        code: "ADMIN_ENVIRONMENT_BINDINGS_COLLIDE",
      }),
    );
  });

  it("rejects the same database target with different credentials and options", () => {
    const environment = exactEnvironment({
      [ADMIN_DATABASE_ENV_NAMES.live]:
        "postgresql://live_user:one@shared.example.test:5432/skitza?sslmode=require",
      [ADMIN_DATABASE_ENV_NAMES.test]:
        "postgres://test_user:two@SHARED.example.test/skitza?pooling=true",
    });

    expect(() => resolveAdminEnvironment(environment, "test")).toThrow(
      expect.objectContaining({
        code: "ADMIN_ENVIRONMENT_BINDINGS_COLLIDE",
      }),
    );
  });

  it("rejects pooled and direct Neon aliases for the same database", () => {
    const environment = exactEnvironment({
      [ADMIN_DATABASE_ENV_NAMES.live]:
        "postgresql://live_user:one@ep-shared-123.us-east-2.aws.neon.tech/skitza?sslmode=require",
      [ADMIN_DATABASE_ENV_NAMES.test]:
        "postgresql://test_user:two@ep-shared-123-pooler.us-east-2.aws.neon.tech/skitza?sslmode=require",
    });

    expect(() => resolveAdminEnvironment(environment, "live")).toThrow(
      expect.objectContaining({
        code: "ADMIN_ENVIRONMENT_BINDINGS_COLLIDE",
      }),
    );
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
          exactEnvironment({
            [ADMIN_DATABASE_ENV_NAMES.live]: invalidBinding,
          }),
          "live",
        );
      } catch (caught) {
        error = caught;
      }

      expect(error).toMatchObject({
        code: "ADMIN_ENVIRONMENT_BINDING_INVALID",
      });
      expect(String(error)).not.toContain(invalidBinding);
    }
  });

  it("resolves only the selected server binding", () => {
    expect(resolveAdminEnvironment(exactEnvironment(), "live")).toEqual({
      databaseUrl: LIVE_DATABASE_URL,
      publicContext: {
        id: "live",
        label: "Live",
        tone: "danger",
      },
    });
    expect(resolveAdminEnvironment(exactEnvironment(), "test")).toEqual({
      databaseUrl: TEST_DATABASE_URL,
      publicContext: {
        id: "test",
        label: "Test",
        tone: "info",
      },
    });
  });

  it("exposes a public context with only id, label, and tone", () => {
    for (const id of ["live", "test"] as const) {
      const context = getAdminEnvironmentPublicContext(id);
      expect(Object.keys(context).sort()).toEqual(["id", "label", "tone"]);
      expect(JSON.stringify(context)).not.toContain("postgresql://");
      expect(JSON.stringify(context)).not.toContain("DATABASE_URL");
    }
  });

  it("does not copy selections or private bindings into errors", () => {
    const privateValue = "do-not-expose-private-database-binding";
    let error: unknown;

    try {
      resolveAdminEnvironment(
        exactEnvironment({
          [ADMIN_DATABASE_ENV_NAMES.live]: privateValue,
          [ADMIN_DATABASE_ENV_NAMES.test]: privateValue,
        }),
        "live",
      );
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(AdminEnvironmentConfigurationError);
    expect(String(error)).not.toContain(privateValue);
  });
});
