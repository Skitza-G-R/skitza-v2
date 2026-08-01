import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const chromeSource = readFileSync(join(here, "..", "wizard-shell", "wizard-chrome.tsx"), "utf8");
const railSource = readFileSync(join(here, "..", "wizard-shell", "step-rail.tsx"), "utf8");
const footerSource = readFileSync(join(here, "..", "wizard-shell", "wizard-footer.tsx"), "utf8");

describe("responsive producer onboarding chrome", () => {
  it("uses a compact mobile header and keeps the desktop rail desktop-only", () => {
    expect(chromeSource).toContain("lg:hidden");
    expect(chromeSource).toContain('className="hidden flex-col');
    expect(chromeSource).toContain("lg:flex");
    expect(chromeSource).toContain("lg:grid-cols");
  });

  it("wires Save and exit to a real dashboard link", () => {
    expect(chromeSource).toContain('href="/dashboard"');
    expect(chromeSource).not.toMatch(/<button[\s\S]*Save &amp; exit/);
  });

  it("keeps one scroll container and a mobile-safe footer", () => {
    expect(chromeSource).toContain("min-h-dvh");
    expect(chromeSource).toContain("overflow-y-auto");
    expect(chromeSource).toContain("env(safe-area-inset-bottom)");
  });

  it("shows Account created as complete from the first editable screen", () => {
    expect(railSource).toContain('step.state === "complete"');
  });

  it("keeps every rail edit link inside the local no-write walkthrough", () => {
    expect(chromeSource).toContain("previewMode={previewMode}");
    expect(railSource).toContain('previewMode ? "?__preview=1" : ""');
  });

  it("gives footer actions 44px touch targets and shared radii", () => {
    expect(footerSource).toContain("min-h-11");
    expect(footerSource).toContain("rounded-[var(--radius-lg)]");
    expect(footerSource).not.toContain("rounded-full");
  });
});
