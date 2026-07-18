import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));

describe("project reopen concurrency locks", () => {
  it("takes the shared client advisory lock before the project advisory lock", () => {
    const repositorySource = readFileSync(join(here, "..", "db.ts"), "utf8");
    const clientLock = repositorySource.indexOf("clientAdvisoryLockKey(discoveredReopenClientId)");
    const projectLock = repositorySource.indexOf("projectAdvisoryLockKey(scope.projectId)");

    expect(clientLock).toBeGreaterThan(-1);
    expect(projectLock).toBeGreaterThan(clientLock);
    expect(repositorySource).toContain("producerArchivedAt: clientContacts.producerArchivedAt");
    expect(repositorySource).toContain('.for("update")');
  });
});
