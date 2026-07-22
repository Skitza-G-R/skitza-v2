import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(here, "..", "availability-panel.tsx"), "utf-8");

describe("AvailabilityPanel — truthful booking preferences", () => {
  it("does not expose a local-only session buffer control", () => {
    expect(SRC).not.toContain("Buffer between sessions");
    expect(SRC).not.toContain("BUFFER_MIN");
    expect(SRC).not.toContain("draftBuffer");
    expect(SRC).not.toContain("calendar v2");
  });

  it("renders the resolved timezone as plain text without a disclosure affordance", () => {
    expect(SRC).toMatch(/<p[^>]*>\s*\{getTimezoneLabel\(\)\}\s*<\/p>/);
    expect(SRC).not.toContain("<ChevronDown />");
    expect(SRC).not.toMatch(/function ChevronDown\(/);
  });

  it("rolls optimistic booking preferences back and locks controls while saving", () => {
    expect(SRC).toContain("runOptimisticPreferenceSave");
    expect(SRC).toContain("rollback:");
    expect(SRC).toContain("disabled={isSaving}");
    expect(SRC).toContain("weekStartSaving");
  });

  it("keeps the switch track compact inside a 44px mobile hit target", () => {
    expect(SRC).toContain("h-11 w-11");
    expect(SRC).toContain("h-[22px] w-[36px]");
  });

  it("gives each working-day switch its own name and respects reduced motion", () => {
    expect(SRC).toContain('label={`${dayLabel} availability`}');
    expect(SRC).toContain('label="Auto-confirm bookings"');
    expect(SRC).toContain("aria-label={label}");
    expect(SRC.match(/motion-reduce:transition-none/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it("uses the shared accessible dialog and confirms before removing a blocked date", () => {
    expect(SRC).toContain('from "~/components/ui/dialog"');
    expect(SRC).not.toContain("function BasicDialog");
    expect(SRC).toContain("setRemoveTarget(b)");
    expect(SRC).toContain("Remove this blocked date?");
    const closeIndex = SRC.indexOf("setRemoveTarget(null)", SRC.indexOf("const target = removeTarget"));
    const removeIndex = SRC.indexOf("handleRemove(target.id)");
    expect(closeIndex).toBeGreaterThan(-1);
    expect(removeIndex).toBeGreaterThan(closeIndex);
  });
});
