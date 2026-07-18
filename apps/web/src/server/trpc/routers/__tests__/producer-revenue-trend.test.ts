import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, "..", "producer.ts"), "utf8");

describe("producer.revenueTrend SK-90 boundary", () => {
  it("does not reinterpret removed invoice rows as purchase-ledger revenue", () => {
    const procedure = source.slice(
      source.indexOf("revenueTrend: producerProcedure"),
      source.indexOf("urgentProjects: producerProcedure"),
    );

    expect(procedure).not.toContain("invoices");
    expect(procedure).toContain("Corrections and waivers make raw-payment aggregation unsafe");
    expect(procedure).toMatch(/const rows:[\s\S]*= \[\];/);
    expect(procedure).toContain("return { points, currency: defaultCurrency }");
  });
});
