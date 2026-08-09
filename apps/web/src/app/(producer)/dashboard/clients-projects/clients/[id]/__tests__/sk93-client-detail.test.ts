import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, "..", "page.tsx"), "utf8");
const compactSource = source.replace(/\s+/g, " ");

describe("SK-93 client detail preservation through SK-146", () => {
  it("passes the complete purchase-owned ledger into ClientSpaceWorkspace", () => {
    expect(source).toContain("caller.purchaseLedger.client({ clientContactId: id })");
    expect(source).toContain("toClientPaymentsData(paymentModel");
    expect(compactSource).toMatch(
      /<ClientSpaceWorkspace[\s\S]*?payments=\{payments\}[\s\S]*?initialTab=\{initialTab\}/,
    );
    expect(source).not.toMatch(/<ClientMoneyLedger/);
  });

  it("preserves tags and producer archive rules in visible workspace data", () => {
    expect(source).toMatch(/tags:\s*detail\.contact\.tags/);
    expect(source).toMatch(/archived:\s*detail\.contact\.producerArchivedAt\s*!==\s*null/);
    expect(source).toContain("detail.stats.archiveBlockingProjectCount");
    expect(source).toMatch(/canPermanentlyDelete:\s*detail\.contact\.canPermanentlyDelete/);
    expect(compactSource).toContain("client={client} projects={projects}");
  });

  it("keeps archived project and payment history reachable through the tabs", () => {
    expect(source).toContain("const projects: ClientSpaceProjectData[] = detail.projects.map");
    expect(source).toContain("toClientPaymentsData(paymentModel");
    expect(source).toContain("payments={payments}");
    expect(source).not.toMatch(/detail\.projects\.filter/);
  });
});
