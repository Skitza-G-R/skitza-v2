import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("--copper token", () => {
  it("is defined in globals.css with the exact handoff value", () => {
    const css = readFileSync(
      join(__dirname, "../app/globals.css"),
      "utf-8",
    );
    expect(css).toMatch(/--copper:\s*#B06830/);
  });
});
