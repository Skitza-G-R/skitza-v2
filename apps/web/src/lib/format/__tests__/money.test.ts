import { describe, expect, it } from "vitest";

import { currencySymbol, formatMoney } from "../money";

// Money formatter — pin the consolidation contract that replaces
// Phase 5's two inline implementations (balance-card.tsx +
// store/product-card.tsx). Behaviour-preserving rename: the
// canonical output is the `.toLocaleString()` path with no decimals.

describe("formatMoney", () => {
  it("renders USD with the dollar symbol, no decimals by default", () => {
    expect(formatMoney(28000, "USD")).toBe("$280");
  });

  it("inserts a thousands separator for amounts ≥ 1000 (replaces Phase 5 balance-card.toFixed bug)", () => {
    expect(formatMoney(199900, "USD")).toBe("$1,999");
    expect(formatMoney(345000, "USD")).toBe("$3,450");
  });

  it("supports the locked v1 currency set: USD / EUR / GBP / ILS", () => {
    expect(formatMoney(10000, "USD")).toBe("$100");
    expect(formatMoney(10000, "EUR")).toBe("€100");
    expect(formatMoney(10000, "GBP")).toBe("£100");
    expect(formatMoney(10000, "ILS")).toBe("₪100");
  });

  it("normalises currency casing (lowercase still resolves)", () => {
    expect(formatMoney(10000, "usd")).toBe("$100");
    expect(formatMoney(10000, "eur")).toBe("€100");
  });

  it("falls back to `<code> ` prefix for unknown currencies", () => {
    expect(formatMoney(10000, "JPY")).toBe("JPY 100");
    expect(formatMoney(10000, "CAD")).toBe("CAD 100");
  });

  it("rounds away decimals when withCents is omitted", () => {
    // 1999 cents = $19.99 → $20 (default rounds toward major). This
    // matches both Phase 5 inline implementations' `.toFixed(0)` /
    // `maximumFractionDigits: 0` behaviour.
    expect(formatMoney(1999, "USD")).toBe("$20");
    // 1549 cents = $15.49 → $15 (round-half-up below the .5 boundary).
    expect(formatMoney(1549, "USD")).toBe("$15");
    // Whole-major values format unchanged.
    expect(formatMoney(1500, "USD")).toBe("$15");
  });

  it("renders two decimal places when withCents is true", () => {
    expect(formatMoney(1999, "USD", { withCents: true })).toBe("$19.99");
    expect(formatMoney(7500, "USD", { withCents: true })).toBe("$75.00");
    expect(formatMoney(199900, "USD", { withCents: true })).toBe("$1,999.00");
  });

  it("handles zero and negatives", () => {
    expect(formatMoney(0, "USD")).toBe("$0");
    expect(formatMoney(-5000, "USD")).toBe("-$50");
  });
});

describe("currencySymbol", () => {
  it("returns the symbol for known currencies", () => {
    expect(currencySymbol("USD")).toBe("$");
    expect(currencySymbol("EUR")).toBe("€");
    expect(currencySymbol("GBP")).toBe("£");
    expect(currencySymbol("ILS")).toBe("₪");
  });

  it("falls back to `<code> ` for unknown currencies", () => {
    expect(currencySymbol("JPY")).toBe("JPY ");
  });

  it("normalises casing", () => {
    expect(currencySymbol("usd")).toBe("$");
  });
});
