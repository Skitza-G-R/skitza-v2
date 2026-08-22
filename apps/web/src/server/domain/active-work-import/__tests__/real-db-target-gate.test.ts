import { describe, expect, it } from "vitest";

import {
  ACTIVE_WORK_IMPORT_REAL_DB_ENV,
  confirmedActiveWorkImportTestDatabaseUrl,
} from "./real-db-target-gate";

const SECRET_URL = "postgresql://secret-user:secret-password@test.invalid/neondb?sslmode=require";

function environment(overrides: Record<string, string | undefined> = {}) {
  return {
    NODE_ENV: "test",
    [ACTIVE_WORK_IMPORT_REAL_DB_ENV.databaseUrl]: SECRET_URL,
    [ACTIVE_WORK_IMPORT_REAL_DB_ENV.neonProjectId]: "raspy-pine-96654399",
    [ACTIVE_WORK_IMPORT_REAL_DB_ENV.neonBranchName]: "sk-255-test",
    [ACTIVE_WORK_IMPORT_REAL_DB_ENV.targetConfirmation]: "confirmed-development-test",
    ...overrides,
  };
}

describe("SK-255 real database target gate", () => {
  it("skips without a target URL and accepts only the fully confirmed test branch", () => {
    expect(confirmedActiveWorkImportTestDatabaseUrl({ NODE_ENV: "test" })).toBeNull();
    expect(confirmedActiveWorkImportTestDatabaseUrl(environment())).toBe(SECRET_URL);
  });

  it.each([
    [
      "forbidden old project",
      { [ACTIVE_WORK_IMPORT_REAL_DB_ENV.neonProjectId]: "quiet-sun-92221754" },
    ],
    ["wrong branch", { [ACTIVE_WORK_IMPORT_REAL_DB_ENV.neonBranchName]: "production" }],
    ["missing confirmation", { [ACTIVE_WORK_IMPORT_REAL_DB_ENV.targetConfirmation]: undefined }],
    ["non-test process", { NODE_ENV: "production" }],
  ])("rejects %s without exposing connection credentials", (_label, overrides) => {
    let error: unknown;
    try {
      confirmedActiveWorkImportTestDatabaseUrl(environment(overrides));
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(Error);
    expect(String(error)).not.toContain(SECRET_URL);
    expect(String(error)).not.toContain("secret-password");
    expect(String(error)).not.toContain("secret-user");
  });
});
