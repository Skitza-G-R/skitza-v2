import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, "..", "page.tsx"), "utf8");

describe("SK-93 client detail", () => {
  it("renders the complete purchase-owned client ledger", () => {
    expect(source).toContain("ProducerPaymentWorkspace");
    expect(source).toMatch(/purchaseLedger\.client/);
    expect(source).toMatch(/toProducerPaymentWorkspaceBuckets\(payments\.producerBuckets\)/);
    expect(source).not.toMatch(/<ClientMoneyLedger/);
  });

  it("passes tags and producer archive state to visible detail actions", () => {
    expect(source).toMatch(/tags:\s*detail\.contact\.tags/);
    expect(source).toMatch(/archived:\s*detail\.contact\.producerArchivedAt\s*!==\s*null/);
    expect(source).toContain("archiveBlockingProjectCount");
  });

  it("keeps the project list and money ledger visible for archived clients", () => {
    expect(source).toMatch(/<ClientSpaceHero/);
    expect(source).toMatch(/<ProjectRow/);
    expect(source).toMatch(/<ProducerPaymentWorkspace/);
  });
});
