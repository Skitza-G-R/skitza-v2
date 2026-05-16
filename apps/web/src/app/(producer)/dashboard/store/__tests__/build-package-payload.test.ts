import { describe, expect, it } from "vitest";

import {
  buildPackagePayload,
  type PackageDraft,
} from "../build-package-payload";

// Pure mapping under test — given a Draft, what gets sent on the
// wire? Covers both flat (default) and per-song product saves.

function flatDraft(overrides: Partial<PackageDraft> = {}): PackageDraft {
  return {
    name: "Mixing",
    tagline: "",
    type: "mix",
    price: 200,
    currency: "USD",
    sessions: 1,
    unlimitedSessions: false,
    paymentPlan: "full",
    installmentsCount: 3,
    duration: "60 min",
    revisions: 0,
    unlimitedRevisions: false,
    contractMode: "link",
    contractUrl: "",
    contractText: "",
    pricingModel: "flat",
    volumeTiers: [],
    ...overrides,
  };
}

describe("buildPackagePayload — flat-price products", () => {
  it("maps a typical flat draft to the wire shape", () => {
    const payload = buildPackagePayload(flatDraft());
    expect(payload.name).toBe("Mixing");
    expect(payload.priceCents).toBe(20000);
    expect(payload.currency).toBe("USD");
    expect(payload.durationMin).toBe(60);
    expect(payload.sessionCount).toBe(1);
    expect(payload.paymentPlans).toEqual([{ kind: "full" }]);
    expect(payload.depositPct).toBe(0);
    expect(payload.contractUrl).toBeNull();
    expect(payload.pricingModel).toBe("flat");
    expect(payload.volumeTiers).toEqual([]);
  });

  it("encodes unlimitedSessions as sessionCount=0 (the canonical marker)", () => {
    const payload = buildPackagePayload(
      flatDraft({ unlimitedSessions: true, sessions: 5 }),
    );
    expect(payload.sessionCount).toBe(0);
  });

  it("maps the three payment plan choices through to discriminated-union shape", () => {
    expect(buildPackagePayload(flatDraft({ paymentPlan: "full" })).paymentPlans)
      .toEqual([{ kind: "full" }]);
    expect(buildPackagePayload(flatDraft({ paymentPlan: "split" })).paymentPlans)
      .toEqual([{ kind: "split_50_50" }]);
    expect(
      buildPackagePayload(flatDraft({ paymentPlan: "installments", installmentsCount: 6 })).paymentPlans,
    ).toEqual([{ kind: "monthly", installments: 6 }]);
  });

  it("clamps installments to a minimum of 2", () => {
    const payload = buildPackagePayload(
      flatDraft({ paymentPlan: "installments", installmentsCount: 1 }),
    );
    expect(payload.paymentPlans).toEqual([{ kind: "monthly", installments: 2 }]);
  });

  it("trims the contract URL on link mode + nulls when empty", () => {
    expect(buildPackagePayload(flatDraft({ contractMode: "link", contractUrl: "  https://x.com/c  " })).contractUrl)
      .toBe("https://x.com/c");
    expect(buildPackagePayload(flatDraft({ contractMode: "link", contractUrl: "" })).contractUrl)
      .toBeNull();
  });

  it("nulls contractUrl on text mode regardless of url field", () => {
    const payload = buildPackagePayload(
      flatDraft({ contractMode: "text", contractUrl: "https://leftover.com", contractText: "Terms…" }),
    );
    expect(payload.contractUrl).toBeNull();
  });

  it("preserves an existing DB kind when editing (legacy 'session'/'mixing')", () => {
    const payload = buildPackagePayload(flatDraft({ type: "mix" }), "session");
    expect(payload.kind).toBe("session");
  });

  it("routes 'consult' preset to 'custom' on create (no DB enum for consult)", () => {
    const payload = buildPackagePayload(flatDraft({ type: "consult" }));
    expect(payload.kind).toBe("custom");
  });
});

describe("buildPackagePayload — per-song products", () => {
  const PER_SONG_TIERS = [
    { minQty: 1, pricePerUnitCents: 20000 },
    { minQty: 5, pricePerUnitCents: 15000 },
  ];

  function perSongDraft(overrides: Partial<PackageDraft> = {}): PackageDraft {
    return flatDraft({
      pricingModel: "per_song",
      volumeTiers: PER_SONG_TIERS,
      price: 200, // mirrors volumeTiers[0] / 100; see updateBaseTier()
      ...overrides,
    });
  }

  it("emits pricingModel='per_song' and the full volumeTiers ladder", () => {
    const payload = buildPackagePayload(perSongDraft());
    expect(payload.pricingModel).toBe("per_song");
    expect(payload.volumeTiers).toEqual(PER_SONG_TIERS);
  });

  it("mirrors the base tier into priceCents so flat-price code paths keep working", () => {
    const payload = buildPackagePayload(perSongDraft({ price: 200 }));
    expect(payload.priceCents).toBe(20000);
    expect(payload.priceCents).toBe(PER_SONG_TIERS[0]?.pricePerUnitCents);
  });

  it("keeps everything else identical to the flat shape (carrier columns unchanged)", () => {
    const payload = buildPackagePayload(perSongDraft());
    expect(payload.depositPct).toBe(0);
    expect(payload.sessionCount).toBe(1);
    expect(payload.durationMin).toBe(60);
    expect(payload.paymentPlans).toEqual([{ kind: "full" }]);
  });
});
