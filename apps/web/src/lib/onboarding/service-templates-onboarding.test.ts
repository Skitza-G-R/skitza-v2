import { describe, expect, it } from "vitest";

import {
  ONBOARDING_SERVICE_TEMPLATES,
  PAYMENT_PLANS,
  SUPPORTED_CURRENCIES,
  depositPctForPlan,
  isServiceContinueAllowed,
  type OnboardingServiceTemplateId,
} from "./service-templates-onboarding";

describe("ONBOARDING_SERVICE_TEMPLATES — 4 redesign starter templates", () => {
  it("has exactly 4 templates (mix / production / studio / custom)", () => {
    expect(ONBOARDING_SERVICE_TEMPLATES).toHaveLength(4);
  });

  it("ids match the redesign's 2x2 grid", () => {
    const ids = ONBOARDING_SERVICE_TEMPLATES.map((t) => t.id);
    expect(ids).toEqual<OnboardingServiceTemplateId[]>([
      "mix",
      "production",
      "studio",
      "custom",
    ]);
  });

  it("non-custom templates have a non-empty defaultName + price > 0", () => {
    for (const t of ONBOARDING_SERVICE_TEMPLATES) {
      if (t.id === "custom") continue;
      expect(t.defaultName.length).toBeGreaterThan(0);
      expect(t.defaultPrice).toBeGreaterThan(0);
      expect(t.defaultSessions).toBeGreaterThan(0);
    }
  });

  it("custom template has empty defaultName (forces producer to type)", () => {
    const custom = ONBOARDING_SERVICE_TEMPLATES.find((t) => t.id === "custom");
    expect(custom?.defaultName).toBe("");
  });
});

describe("SUPPORTED_CURRENCIES", () => {
  it("matches the codebase's existing currency set (USD/EUR/GBP/ILS)", () => {
    expect(SUPPORTED_CURRENCIES).toEqual(["USD", "EUR", "GBP", "ILS"]);
  });
});

describe("PAYMENT_PLANS", () => {
  it("has 3 plans matching the redesign segmented control", () => {
    expect(PAYMENT_PLANS.map((p) => p.id)).toEqual([
      "full",
      "deposit",
      "monthly",
    ]);
  });
});

describe("isServiceContinueAllowed", () => {
  it("allows continue when name >= 2 chars + price > 0 + sessions >= 1", () => {
    expect(isServiceContinueAllowed("Mix & Master", 800, 1)).toBe(true);
  });

  it("blocks continue when name is empty / 1-char / whitespace", () => {
    expect(isServiceContinueAllowed("", 800, 1)).toBe(false);
    expect(isServiceContinueAllowed("a", 800, 1)).toBe(false);
    expect(isServiceContinueAllowed("   ", 800, 1)).toBe(false);
  });

  it("blocks continue when price is 0 or negative", () => {
    expect(isServiceContinueAllowed("Mix & Master", 0, 1)).toBe(false);
    expect(isServiceContinueAllowed("Mix & Master", -1, 1)).toBe(false);
  });

  it("blocks continue when sessions < 1", () => {
    expect(isServiceContinueAllowed("Mix & Master", 800, 0)).toBe(false);
  });
});

describe("depositPctForPlan", () => {
  it("full → 0% deposit, deposit → 50%, monthly → 25%", () => {
    expect(depositPctForPlan("full")).toBe(0);
    expect(depositPctForPlan("deposit")).toBe(50);
    expect(depositPctForPlan("monthly")).toBe(25);
  });
});
