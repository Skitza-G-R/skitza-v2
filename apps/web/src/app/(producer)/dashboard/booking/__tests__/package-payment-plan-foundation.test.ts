import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));

function source(relativePath: string): string {
  return readFileSync(join(here, relativePath), "utf8");
}

describe("producer package payment-plan foundation", () => {
  it("does not expose or send the retired product deposit percentage", () => {
    const activeSources = [
      source("../package-form.tsx"),
      source("../actions.ts"),
      source("../package-toolbar.tsx"),
      source("../../../../../lib/service-templates.ts"),
      source("../../../../../components/dashboard/setup/services-section.tsx"),
    ];

    for (const activeSource of activeSources) {
      expect(activeSource).not.toMatch(/depositPct|hideDepositField|Deposit percent/);
    }
  });

  it("keeps the structured full, 50/50, and monthly plans in the editor", () => {
    const form = source("../package-form.tsx");

    expect(form).toMatch(/name="plan_full"/);
    expect(form).toMatch(/name="plan_split"/);
    expect(form).toMatch(/name="plan_monthly"/);
    expect(form).toMatch(/50\/50 split/);
  });
});
