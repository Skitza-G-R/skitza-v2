import { describe, expect, it } from "vitest";

import {
  buildPackagePayload,
  buildPackageUpdatePayload,
  type PackageDraft,
} from "../build-package-payload";
import { royaltyTermsToDraft } from "../product-editor-draft";

function flatDraft(overrides: Partial<PackageDraft> = {}): PackageDraft {
  return {
    name: "Mixing",
    tagline: "A clear, focused mix.",
    type: "mix",
    price: 200,
    currency: "USD",
    sessions: 1,
    unlimitedSessions: false,
    bookingEnabled: false,
    payment: {
      full: true,
      split50: false,
      monthly: false,
      monthlyInstallments: 4,
    },
    includes: ["Mix", "Instrumental", "Stems"],
    duration: "60 min",
    revisions: 2,
    unlimitedRevisions: false,
    agreementMode: "none",
    agreementText: "",
    royalty: {
      ...royaltyTermsToDraft(null),
      masterMode: "none",
      compositionMode: "none",
    },
    pricingModel: "flat",
    volumeTiers: [],
    ...overrides,
  };
}

describe("buildPackagePayload", () => {
  it("maps a complete product", () => {
    const payload = buildPackagePayload(flatDraft());

    expect(payload).toMatchObject({
      name: "Mixing",
      priceCents: 20_000,
      currency: "USD",
      durationMin: 60,
      sessionCount: 1,
      bookingEnabled: false,
      paymentPlans: [{ kind: "full" }],
      deliverables: ["Mix", "Instrumental", "Stems"],
      royaltyTerms: {
        master: { mode: "none" },
        composition: { mode: "none" },
      },
      agreementText: null,
      contractUrl: null,
      pricingModel: "flat",
      volumeTiers: [],
    });
  });

  it("stores the exact trimmed artist-facing tagline", () => {
    const payload = buildPackagePayload(flatDraft({ tagline: "  Release-ready clarity.  " }));

    expect(payload.description.startsWith("Release-ready clarity.\n")).toBe(true);
    expect(payload.description).not.toContain("  Release-ready clarity.");
  });

  it("builds all selected plans in deterministic order", () => {
    const payload = buildPackagePayload(
      flatDraft({
        payment: {
          full: true,
          split50: true,
          monthly: true,
          monthlyInstallments: 6,
        },
      }),
    );

    expect(payload.paymentPlans).toEqual([
      { kind: "full" },
      { kind: "split_50_50" },
      { kind: "monthly", installments: 6 },
    ]);
  });

  it("saves payment options for per-song products", () => {
    const tiers = [
      { minQty: 1, pricePerUnitCents: 20_000 },
      { minQty: 5, pricePerUnitCents: 15_000 },
    ];
    const payload = buildPackagePayload(
      flatDraft({
        pricingModel: "per_song",
        volumeTiers: tiers,
        payment: {
          full: true,
          split50: true,
          monthly: false,
          monthlyInstallments: 4,
        },
      }),
    );

    expect(payload.pricingModel).toBe("per_song");
    expect(payload.volumeTiers).toEqual(tiers);
    expect(payload.paymentPlans).toEqual([{ kind: "full" }, { kind: "split_50_50" }]);
  });

  it("moves legacy inline terms to agreementText without losing tagline or revisions", () => {
    const payload = buildPackagePayload(
      flatDraft({
        tagline: "Full production from demo to master.",
        revisions: 4,
        agreementMode: "text",
        agreementText: "The exact terms the artist accepts.",
      }),
    );

    expect(payload.agreementText).toBe("The exact terms the artist accepts.");
    expect(payload.description).toContain("Full production from demo to master.");
    expect(payload.description).toContain("revisions: 4");
    expect(payload.description).not.toContain("The exact terms the artist accepts.");
  });

  it("writes exact basis points and optional composition metadata", () => {
    const payload = buildPackagePayload(
      flatDraft({
        royalty: {
          masterMode: "percentage",
          masterPercentage: "2.5",
          compositionMode: "percentage",
          compositionPercentage: "12.50",
          compositionRole: "composer",
          collectingSociety: "ACUM",
          notes: "Headline terms only.",
        },
      }),
    );

    expect(payload.royaltyTerms).toEqual({
      master: { mode: "percentage", bps: 250 },
      composition: {
        mode: "percentage",
        bps: 1250,
        role: "composer",
        collectingSociety: "ACUM",
      },
      notes: "Headline terms only.",
    });
  });

  it("keeps a legacy null royalty compatibility state", () => {
    expect(
      buildPackagePayload(flatDraft({ royalty: royaltyTermsToDraft(null) })).royaltyTerms,
    ).toBeNull();
  });

  it("clears a legacy external link and persists only exact inline terms", () => {
    const legacyShapedDraft = {
      ...flatDraft({
        agreementMode: "text",
        agreementText: "  The exact terms the artist accepts.  ",
      }),
      contractUrl: "https://example.com/changeable-terms",
    };

    const payload = buildPackagePayload(legacyShapedDraft);

    expect(payload.contractUrl).toBeNull();
    expect(payload.agreementText).toBe("The exact terms the artist accepts.");
  });

  it("preserves unlimited sessions and the existing product kind", () => {
    const payload = buildPackageUpdatePayload(
      flatDraft({ unlimitedSessions: true, sessions: 5, bookingEnabled: true }),
      "session",
    );
    expect(payload.sessionCount).toBe(0);
    expect(payload.bookingEnabled).toBe(true);
    expect(payload.kind).toBe("session");
    expect(payload).not.toHaveProperty("depositPct");
    expect(payload).not.toHaveProperty("depositModel");
    expect(payload).not.toHaveProperty("milestones");
  });
});
