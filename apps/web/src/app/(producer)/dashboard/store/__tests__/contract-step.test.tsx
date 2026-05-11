import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(here, "..", "editor-steps", "contract-step.tsx"), "utf8");

describe("ContractStep shell", () => {
  it("renders the optional intro copy with the 3x stat", () => {
    expect(SRC).toMatch(/optional|Optional/);
    expect(SRC).toMatch(/3×|3x/);
  });

  it("renders a URL input bound to contractUrl", () => {
    expect(SRC).toMatch(/<input/);
    expect(SRC).toMatch(/type="url"/);
    expect(SRC).toMatch(/contractUrl/);
  });

  it("has a 'Skip' affordance hint (file upload and inline-text deferred)", () => {
    expect(SRC).toMatch(/Skip|skip/);
  });
});
