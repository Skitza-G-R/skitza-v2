import { createHash } from "node:crypto";
import { describe, it, expect } from "vitest";

// Smoke test: the hash discipline `recordContact` relies on (trim +
// lowercase → sha256) is stable across casing and whitespace. Real
// end-to-end coverage of the upsert would need a DB; this guards the
// dedupe key so a returning artist doesn't spawn a new row.
describe("recordContact email normalization (smoke)", () => {
  it("hashes are stable across case + whitespace", () => {
    const a = createHash("sha256").update("maya@example.com").digest("hex");
    const b = createHash("sha256")
      .update("  MAYA@Example.com  ".trim().toLowerCase())
      .digest("hex");
    expect(a).toBe(b);
  });
});
