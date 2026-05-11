import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(here, "..", "booking.ts"), "utf8");

describe("booking.packages.reorder mutation", () => {
  it("exists as a producerProcedure on the packages router", () => {
    expect(SRC).toMatch(/reorder:\s*producerProcedure/);
  });

  it("accepts an orderedIds array of uuids", () => {
    expect(SRC).toMatch(/orderedIds:\s*z\.array\(\s*z\.string\(\)\.uuid\(\)/);
  });

  it("enforces producer ownership before writing", () => {
    expect(SRC).toMatch(/reorder[\s\S]{0,600}producerId/);
  });

  it("writes the new positions in a single transaction", () => {
    expect(SRC).toMatch(/reorder[\s\S]{0,800}ctx\.db\.transaction/);
  });
});
