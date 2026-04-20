import { describe, expect, it } from "vitest";

import { findTemplate, SERVICE_TEMPLATES } from "./service-templates";

// Guardrail tests for the static template catalog. The values are
// plain data, but template ids flow through URLs + form pre-fill; a
// rename here breaks the card click-handler silently unless caught.

describe("service-templates", () => {
  it("exposes exactly 5 templates with the documented ids", () => {
    expect(SERVICE_TEMPLATES).toHaveLength(5);
    const ids = SERVICE_TEMPLATES.map((t) => t.id).sort();
    expect(ids).toEqual([
      "album-package",
      "mastering-pass",
      "mix-3h",
      "remote-feedback",
      "weekend-intensive",
    ]);
  });

  it("every template has a complete defaults payload", () => {
    for (const t of SERVICE_TEMPLATES) {
      expect(t.defaults.name.length).toBeGreaterThan(0);
      expect(t.defaults.description.length).toBeGreaterThan(0);
      expect(t.defaults.priceCents).toBeGreaterThanOrEqual(0);
      expect(t.defaults.durationMin).toBeGreaterThan(0);
      expect(t.defaults.sessionCount).toBeGreaterThan(0);
      expect(t.defaults.depositPct).toBeGreaterThanOrEqual(0);
      expect(t.defaults.depositPct).toBeLessThanOrEqual(100);
      expect(t.defaults.paymentPlans.length).toBeGreaterThan(0);
    }
  });

  it("findTemplate returns undefined for unknown ids and the null input", () => {
    expect(findTemplate("does-not-exist")).toBeUndefined();
    expect(findTemplate(null)).toBeUndefined();
  });

  it("findTemplate looks up by id", () => {
    const t = findTemplate("mix-3h");
    expect(t?.title).toBe("3-hour mixing session");
    expect(t?.defaults.kind).toBe("mixing");
    expect(t?.defaults.priceCents).toBe(15000);
  });

  it("album-package uses the split_50_50 payment plan", () => {
    const t = findTemplate("album-package");
    expect(t?.defaults.paymentPlans[0]?.kind).toBe("split_50_50");
  });
});
