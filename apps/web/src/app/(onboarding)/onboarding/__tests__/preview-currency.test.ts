import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const onboardingDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const studioSource = readFileSync(join(onboardingDir, "studio", "page.tsx"), "utf8");
const serviceSource = readFileSync(join(onboardingDir, "service", "page.tsx"), "utf8");
const reviewSource = readFileSync(join(onboardingDir, "review", "page.tsx"), "utf8");

describe("onboarding preview currency", () => {
  it.each([
    ["public page", studioSource],
    ["first product", serviceSource],
    ["review", reviewSource],
  ])("derives the %s preview from the request locale", (_label, source) => {
    expect(source).toContain("inferCurrency(");
    expect(source).toContain('"x-vercel-ip-country"');
    expect(source).toContain('"accept-language"');
  });

  it("does not force USD into any preview-only fixture", () => {
    expect(studioSource).not.toContain('initialCurrency="USD"');
    expect(serviceSource).not.toContain('defaultCurrency="USD"');
    expect(reviewSource).not.toMatch(/currency:\s*"USD"/);
    expect(reviewSource).toContain("currency: previewCurrency");
  });
});
