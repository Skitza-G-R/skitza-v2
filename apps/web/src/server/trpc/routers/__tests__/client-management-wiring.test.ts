import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const routerSource = readFileSync(join(here, "..", "client-contacts.ts"), "utf8");

describe("SK-93 client-management router wiring", () => {
  it("keeps edit, archive, and restore behind the focused client-management domain", () => {
    expect(routerSource).toContain("clientManagementRepository");
    expect(routerSource).toContain("editClient");
    expect(routerSource).toContain("archiveClient");
    expect(routerSource).toContain("restoreClient");
  });

  it("accepts every approved editable field and no ownership field", () => {
    const updateInput = routerSource.match(
      /update:\s*producerProcedure[\s\S]*?\.input\(([\s\S]*?)\)\s*\.mutation/,
    )?.[1];
    expect(updateInput).toBeDefined();
    for (const field of ["name", "email", "phone", "notes", "tags"]) {
      expect(updateInput).toMatch(new RegExp(`${field}:`));
    }
    expect(updateInput).not.toMatch(/clerkUserId:/);
    expect(updateInput).not.toMatch(/producerId:/);
  });

  it("exposes producer archive state on list and detail reads", () => {
    expect(routerSource).toMatch(/producerArchivedAt:\s*clientContacts\.producerArchivedAt/g);
    expect(routerSource).toContain("archiveBlockingProjectCount");
  });

  it("loads purchase-owned client money through the stable producer/client scope", () => {
    expect(routerSource).toContain("clientMoneyRepository");
    expect(routerSource).toContain("getClientMoneyLedger");
    expect(routerSource).toMatch(/producerId:\s*ctx\.producerId/);
    expect(routerSource).toMatch(/clientContactId:\s*input\.id/);
  });
});
