import { describe, expect, it } from "vitest";

import {
  agreementFor,
  durationLabel,
  toProducer,
  toPurchaseProduct,
} from "../product-mapping";

const ROW = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Single — start to finish",
  priceCents: 240000,
  currency: "ILS",
  sessionCount: 3,
  durationMin: 120,
  deliverables: ["Full mix + master", "WAV stems"],
  producerName: "Gili Studio",
  contractUrl: "https://r2.example.com/contracts/Booking%20Agreement.pdf",
};

describe("durationLabel", () => {
  it("renders a single session with minutes", () => {
    expect(durationLabel(1, 90)).toBe("Single session · 1h 30m");
    expect(durationLabel(1, 45)).toBe("Single session · 45 min");
  });

  it("renders multi-session products with a per-session length", () => {
    expect(durationLabel(3, 120)).toBe("3 sessions · 2h each");
  });
});

describe("agreementFor", () => {
  it("derives the filename from the contract URL (decoded)", () => {
    expect(agreementFor(ROW.contractUrl)).toEqual({
      filename: "Booking Agreement.pdf",
    });
  });

  it("returns null when the producer has no uploaded agreement", () => {
    expect(agreementFor(null)).toBeNull();
    expect(agreementFor(undefined)).toBeNull();
    expect(agreementFor("")).toBeNull();
  });

  it("falls back to a sane label on an unparseable URL", () => {
    expect(agreementFor("not-a-url")).toEqual({
      filename: "Booking_Agreement.pdf",
    });
  });
});

describe("toPurchaseProduct", () => {
  it("maps real store fields onto the screen shape", () => {
    const product = toPurchaseProduct(ROW);
    expect(product).toEqual({
      id: ROW.id,
      name: ROW.name,
      priceCents: 240000,
      currency: "ILS",
      durationLabel: "3 sessions · 2h each",
      includes: ["Full mix + master", "WAV stems"],
    });
  });

  it("renders an empty includes list when deliverables are unset", () => {
    expect(toPurchaseProduct({ ...ROW, deliverables: null }).includes).toEqual([]);
  });
});

describe("toProducer", () => {
  it("derives initials + a stable hue from the producer name", () => {
    const producer = toProducer(ROW);
    expect(producer.name).toBe("Gili Studio");
    expect(producer.initials).toBe("GS");
    expect(producer.hue).toBeGreaterThanOrEqual(0);
    expect(producer.hue).toBeLessThan(360);
    // deterministic — same name, same hue (matches the store avatars)
    expect(toProducer(ROW).hue).toBe(producer.hue);
    expect(producer.agreement?.filename).toBe("Booking Agreement.pdf");
  });

  it("survives a null producer name and missing contract", () => {
    const producer = toProducer({ ...ROW, producerName: null, contractUrl: null });
    expect(producer.name).toBe("Your producer");
    expect(producer.agreement).toBeNull();
  });
});
