import { describe, expect, it } from "vitest";

import {
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
  description: "Track, comp, mix & master one song.",
  agreementText: "Credit the producer in release metadata.",
  unlimitedRevisions: false,
  royaltyTerms: {
    master: { mode: "percentage" as const, bps: 250 },
    composition: {
      mode: "percentage" as const,
      bps: 1250,
      role: "composer" as const,
      collectingSociety: "ACUM",
    },
  },
  revisions: 2,
  paymentPlans: [
    { kind: "full" as const },
    { kind: "split_50_50" as const },
  ],
  pricingModel: "per_song" as const,
  volumeTiers: [
    { minQty: 1, pricePerUnitCents: 240000 },
    { minQty: 3, pricePerUnitCents: 210000 },
  ],
};

describe("durationLabel", () => {
  it("renders a single session with minutes", () => {
    expect(durationLabel(1, 90)).toBe("Single session · 1h 30m");
    expect(durationLabel(1, 45)).toBe("Single session · 45 min");
  });

  it("renders multi-session products with a per-session length", () => {
    expect(durationLabel(3, 120)).toBe("3 sessions · 2h each");
  });

  it("does not turn an unlimited session allowance into a single session", () => {
    expect(durationLabel(0, 90)).toBe("Unlimited sessions · 1h 30m each");
  });

  it("describes duration zero as no bookable sessions, never unlimited", () => {
    expect(durationLabel(0, 0)).toBe("No bookable sessions included");
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
      tagline: "Track, comp, mix & master one song.",
      sessions: 3,
      unlimitedSessions: false,
      revisions: 2,
      unlimitedRevisions: false,
      paymentPlans: [
        { kind: "full" },
        { kind: "split_50_50" },
      ],
      agreementText: "Credit the producer in release metadata.",
      royaltyTerms: ROW.royaltyTerms,
      pricingModel: "per_song",
      volumeTiers: ROW.volumeTiers,
    });
  });

  it("renders an empty includes list when deliverables are unset", () => {
    expect(toPurchaseProduct({ ...ROW, deliverables: null }).includes).toEqual([]);
  });

  it("keeps legacy null royalty and agreement terms safe", () => {
    const product = toPurchaseProduct({
      ...ROW,
      royaltyTerms: null,
      agreementText: null,
    });
    expect(product.royaltyTerms).toBeNull();
    expect(product.agreementText).toBeNull();
  });

  it("maps explicit unlimited session and revision rules without losing them", () => {
    const product = toPurchaseProduct({
      ...ROW,
      sessionCount: 0,
      revisions: 0,
      unlimitedRevisions: true,
    });
    expect(product.durationLabel).toBe("Unlimited sessions · 2h each");
    expect(product.unlimitedSessions).toBe(true);
    expect(product.unlimitedRevisions).toBe(true);
  });

  it("does not treat a pure-delivery product as unlimited sessions", () => {
    const product = toPurchaseProduct({
      ...ROW,
      durationMin: 0,
      sessionCount: 0,
    });

    expect(product.durationLabel).toBe("No bookable sessions included");
    expect(product.unlimitedSessions).toBe(false);
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
  });

  it("survives a null producer name", () => {
    const producer = toProducer({ ...ROW, producerName: null });
    expect(producer.name).toBe("Your producer");
  });
});
