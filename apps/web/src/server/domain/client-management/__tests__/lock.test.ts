import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { clientAdvisoryLockKey } from "../lock";

const here = dirname(fileURLToPath(import.meta.url));

describe("client archive/project concurrency lock", () => {
  it("derives one stable key for a client", () => {
    expect(clientAdvisoryLockKey(" client-1 ")).toBe("client:client-1");
    expect(() => clientAdvisoryLockKey("  ")).toThrow("Client id must not be empty");
  });

  it("is shared by archive writes and stable project creation", () => {
    const managementDb = readFileSync(join(here, "..", "db.ts"), "utf8");
    const projectDb = readFileSync(
      join(here, "..", "..", "project-ownership", "db.ts"),
      "utf8",
    );

    expect(managementDb).toContain("clientAdvisoryLockKey(scope.clientId)");
    expect(projectDb).toContain("clientAdvisoryLockKey(scope.clientContactId)");
    expect(managementDb).not.toContain("`client:${scope.clientId}`");
    expect(projectDb).not.toContain("`client:${scope.clientContactId}`");
  });
});
