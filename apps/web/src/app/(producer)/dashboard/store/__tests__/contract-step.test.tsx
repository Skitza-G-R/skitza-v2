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

  it("exposes two modes: link / text", () => {
    expect(SRC).toMatch(/"link"/);
    expect(SRC).toMatch(/"text"/);
  });

  it("renders a textarea for the inline-text mode", () => {
    expect(SRC).toMatch(/<textarea/);
    expect(SRC).toMatch(/contractText/);
  });

  it("renders a URL input for the link mode", () => {
    expect(SRC).toMatch(/<input/);
    expect(SRC).toMatch(/type="url"/);
    expect(SRC).toMatch(/contractUrl/);
  });

  it("has a 'Skip' affordance hint", () => {
    expect(SRC).toMatch(/Skip|skip/);
  });
});
