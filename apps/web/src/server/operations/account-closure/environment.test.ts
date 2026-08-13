import { describe, expect, it } from "vitest";

import {
  ACCOUNT_CLOSURE_LIVE_CONFIRMATION,
  ACCOUNT_CLOSURE_LIVE_NEON_ENDPOINT,
  ACCOUNT_CLOSURE_OPERATOR_ENV,
  AccountClosureOperatorSafetyError,
  readAccountClosureOperatorEnvironment,
} from "./environment";

const TEST_DATABASE_URL = "postgresql://operator:private-password@127.0.0.1:5432/skitza_test";
const LIVE_DATABASE_URL = `postgresql://operator:private-password@${ACCOUNT_CLOSURE_LIVE_NEON_ENDPOINT}.us-east-2.aws.neon.tech/skitza?sslmode=require`;

function testEnvironment(): Record<string, string> {
  return {
    [ACCOUNT_CLOSURE_OPERATOR_ENV.actorClerkUserId]: "user_founder_operator",
    [ACCOUNT_CLOSURE_OPERATOR_ENV.clerkInstanceId]: "ins_production",
    [ACCOUNT_CLOSURE_OPERATOR_ENV.databaseUrl]: TEST_DATABASE_URL,
    [ACCOUNT_CLOSURE_OPERATOR_ENV.targetClass]: "test",
  };
}

describe("account-closure operator environment", () => {
  it("accepts only the dedicated test target and actor identity", () => {
    expect(readAccountClosureOperatorEnvironment(testEnvironment())).toEqual({
      actorClerkUserId: "user_founder_operator",
      clerkInstanceId: "ins_production",
      databaseUrl: TEST_DATABASE_URL,
      targetClass: "test",
    });
  });

  it("rejects a missing dedicated URL and any ambient database selector", () => {
    const missing = Object.fromEntries(
      Object.entries(testEnvironment()).filter(
        ([name]) => name !== ACCOUNT_CLOSURE_OPERATOR_ENV.databaseUrl,
      ),
    );
    expect(() => readAccountClosureOperatorEnvironment(missing)).toThrow(
      expect.objectContaining({ code: "ACCOUNT_CLOSURE_ENV_MISSING" }),
    );

    expect(() =>
      readAccountClosureOperatorEnvironment({
        ...testEnvironment(),
        DATABASE_URL: "postgresql://ambient:secret@production.invalid/skitza",
      }),
    ).toThrow(
      expect.objectContaining({
        code: "ACCOUNT_CLOSURE_AMBIENT_DATABASE_ENV_FORBIDDEN",
      }),
    );
  });

  it("requires the exact live confirmation and a Neon-host URL", () => {
    const live = {
      ...testEnvironment(),
      [ACCOUNT_CLOSURE_OPERATOR_ENV.databaseUrl]: LIVE_DATABASE_URL,
      [ACCOUNT_CLOSURE_OPERATOR_ENV.targetClass]: "live",
      [ACCOUNT_CLOSURE_OPERATOR_ENV.liveConfirmation]: ACCOUNT_CLOSURE_LIVE_CONFIRMATION,
    };
    expect(readAccountClosureOperatorEnvironment(live).targetClass).toBe("live");
    expect(
      readAccountClosureOperatorEnvironment({
        ...live,
        [ACCOUNT_CLOSURE_OPERATOR_ENV.databaseUrl]: LIVE_DATABASE_URL.replace(
          ACCOUNT_CLOSURE_LIVE_NEON_ENDPOINT,
          `${ACCOUNT_CLOSURE_LIVE_NEON_ENDPOINT}-pooler`,
        ),
      }).targetClass,
    ).toBe("live");

    expect(() =>
      readAccountClosureOperatorEnvironment({
        ...live,
        [ACCOUNT_CLOSURE_OPERATOR_ENV.liveConfirmation]: "yes",
      }),
    ).toThrow(expect.objectContaining({ code: "ACCOUNT_CLOSURE_ENV_INVALID" }));

    expect(() =>
      readAccountClosureOperatorEnvironment({
        ...live,
        [ACCOUNT_CLOSURE_OPERATOR_ENV.databaseUrl]:
          "postgresql://operator:private-password@database.example.com/skitza?sslmode=require",
      }),
    ).toThrow(expect.objectContaining({ code: "ACCOUNT_CLOSURE_ENV_INVALID" }));

    expect(() =>
      readAccountClosureOperatorEnvironment({
        ...live,
        [ACCOUNT_CLOSURE_OPERATOR_ENV.databaseUrl]:
          "postgresql://operator:private-password@ep-valid-but-wrong.us-east-2.aws.neon.tech/skitza?sslmode=require",
      }),
    ).toThrow(expect.objectContaining({ code: "ACCOUNT_CLOSURE_ENV_INVALID" }));
  });

  it("never includes a private environment value in an error", () => {
    const privateValue = "do-not-print-this-database-secret";
    let error: unknown;
    try {
      readAccountClosureOperatorEnvironment({
        ...testEnvironment(),
        [ACCOUNT_CLOSURE_OPERATOR_ENV.databaseUrl]: privateValue,
      });
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(AccountClosureOperatorSafetyError);
    expect(String(error)).not.toContain(privateValue);
  });
});
