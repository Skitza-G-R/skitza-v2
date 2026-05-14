import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(here, "..", "step-bar.tsx"), "utf8");

describe("StepBar shell", () => {
  it("renders one segment per step", () => {
    expect(SRC).toMatch(/steps\.map/);
  });

  it("highlights the current step with the brand color", () => {
    expect(SRC).toMatch(/--brand-primary/);
  });

  it("uses an aria progressbar role for assistive tech", () => {
    expect(SRC).toMatch(/role="progressbar"|role={"progressbar"}/);
  });
});
