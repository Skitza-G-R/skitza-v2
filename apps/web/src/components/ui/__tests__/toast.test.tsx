import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(here, "..", "toast.tsx"), "utf8");

describe("Toast (dark theme)", () => {
  it("uses --bg-sidebar as the toast surface", () => {
    expect(SRC).toMatch(/--bg-sidebar/);
  });

  it("uses a near-white foreground on the dark surface", () => {
    expect(SRC).toMatch(/rgb\(255_255_255\/0\.95\)/);
  });

  it("sets the SonnerToaster theme to dark", () => {
    expect(SRC).toMatch(/theme=["']dark["']/);
  });

  it("renders the action button in brand-primary for visual prominence", () => {
    expect(SRC).toMatch(/actionButton[\s\S]{0,300}--brand-primary/);
  });

  it("keeps the public useToast API (message, variant, options)", () => {
    expect(SRC).toMatch(/toast:\s*\(\s*message[\s\S]{0,300}variant[\s\S]{0,300}options/);
  });
});
