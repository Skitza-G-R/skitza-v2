import { describe, expect, it } from "vitest";

import { createInstallmentSchedule } from "~/server/domain/purchases/ledger";

import {
  buildSimulation,
  chooseStoryPlan,
  PREVIEW_SIMULATION_INPUT,
  SIMULATED_ARTIST,
  SIMULATION_LABEL,
  simulatedCharges,
  type SimulationInput,
} from "../simulation-model";

const NOW = new Date("2026-09-02T09:00:00.000Z");

function input(overrides: Partial<SimulationInput> = {}): SimulationInput {
  return { ...PREVIEW_SIMULATION_INPUT, ...overrides };
}

describe("simulatedCharges", () => {
  it("matches the server installment schedule for every current plan", () => {
    const totals = [1, 2, 3, 99, 180000, 283201, 1000001];
    for (const total of totals) {
      expect(simulatedCharges({ kind: "full" }, total)).toEqual(
        createInstallmentSchedule({ kind: "full" }, total).map((row) => row.amountCents),
      );
      if (total >= 2) {
        expect(simulatedCharges({ kind: "split_50_50" }, total)).toEqual(
          createInstallmentSchedule({ kind: "split_50_50" }, total).map((row) => row.amountCents),
        );
      }
      for (const installments of [2, 3, 6, 12]) {
        if (total < installments) continue;
        expect(simulatedCharges({ kind: "monthly", installments }, total)).toEqual(
          createInstallmentSchedule({ kind: "monthly", installments }, total).map(
            (row) => row.amountCents,
          ),
        );
      }
    }
  });
});

describe("chooseStoryPlan", () => {
  it("prefers the approval-gated 50/50 story, then full, then monthly", () => {
    expect(chooseStoryPlan([{ kind: "monthly", installments: 3 }, { kind: "full" }])).toEqual({
      kind: "full",
    });
    expect(
      chooseStoryPlan([
        { kind: "full" },
        { kind: "split_50_50" },
        { kind: "monthly", installments: 4 },
      ]),
    ).toEqual({ kind: "split_50_50" });
    expect(chooseStoryPlan([{ kind: "monthly", installments: 3 }])).toEqual({
      kind: "monthly",
      installments: 3,
    });
    expect(chooseStoryPlan([])).toEqual({ kind: "full" });
  });
});

describe("buildSimulation", () => {
  it("tells the story with the producer's real product and one fictional artist", () => {
    const model = buildSimulation(input(), NOW);

    expect(model.producer.name).toBe("Maya Stone");
    expect(model.product.name).toBe("Signature production");
    expect(model.selectedPlan).toEqual({ kind: "split_50_50" });
    expect(model.totalCents).toBe(180000);
    expect(model.dueNowCents).toBe(90000);
    expect(model.remainingCents).toBe(90000);
    expect(model.finalPaymentTrigger).toBe("artist_approval");
    expect(model.planOptions.map((option) => option.choice.kind)).toEqual(["split_50_50", "full"]);
    expect(model.planOptions[0]?.dueNowCents).toBe(90000);
    expect(model.storyPlans).toEqual([{ kind: "split_50_50" }, { kind: "full" }]);

    const numbered = model.frames.filter((frame) => frame.step !== null);
    expect(numbered).toHaveLength(10);
    expect(numbered.map((frame) => frame.step)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(model.frames.at(-1)?.side).toBe("closing");
    expect(model.frames.slice(0, 7).every((frame) => frame.side === "artist")).toBe(true);
    expect(model.frames.slice(7, 10).every((frame) => frame.side === "producer")).toBe(true);
    expect(model.frames.every((frame) => frame.caption.length > 0 && frame.detail.length > 0)).toBe(
      true,
    );
    expect(model.frames[0]?.detail).toContain("Signature production");
    expect(model.frames.find((frame) => frame.id === "pay")?.caption).toContain("₪900");
    expect(model.frames.filter((frame) => frame.interactive).map((frame) => frame.id)).toEqual([
      "needs-you",
      "verify",
    ]);
    expect(model.frames.at(-1)?.detail).toContain(SIMULATED_ARTIST.name);
  });

  it("feeds the real producer review screen a pending proof for the first installment", () => {
    const { proofReview } = buildSimulation(input(), NOW);

    expect(proofReview.proof.artistName).toBe(SIMULATED_ARTIST.name);
    expect(proofReview.proof.projectTitle).toBe(SIMULATED_ARTIST.projectTitle);
    expect(proofReview.proof.productNameSnapshot).toBe("Signature production");
    expect(proofReview.proof.status).toBe("pending");
    expect(proofReview.proof.installmentPosition).toBe(1);
    expect(proofReview.proof.amountCents).toBe(90000);
    expect(proofReview.proof.totalCents).toBe(180000);
    expect(proofReview.proof.createdAt).toBe(NOW);
    expect(proofReview.history).toEqual([proofReview.proof]);
    expect(proofReview.evidenceUrl.startsWith("data:image/svg+xml")).toBe(true);
    expect(decodeURIComponent(proofReview.evidenceUrl)).toContain("Example receipt");
    expect(decodeURIComponent(proofReview.evidenceUrl)).toContain("Maya Stone");
  });

  it("applies the producer's tax mode to the total the artist agrees to", () => {
    const added = buildSimulation(input({ taxMode: "tax_added", taxRatePct: 18 }), NOW);
    expect(added.totalCents).toBe(212400);
    expect(added.dueNowCents).toBe(106200);

    const included = buildSimulation(input({ taxMode: "tax_included", taxRatePct: 18 }), NOW);
    expect(included.totalCents).toBe(180000);
  });

  it("uses the producer's own payment details when saved and a labelled example otherwise", () => {
    const example = buildSimulation(input(), NOW);
    expect(example.paymentDetailsAreExample).toBe(true);
    expect(example.paymentDetails.note).toContain("Example only");

    const own = buildSimulation(
      input({ paymentDetails: { bitPhone: "052-123-4567", note: "Add your name." } }),
      NOW,
    );
    expect(own.paymentDetailsAreExample).toBe(false);
    expect(own.paymentDetails.bitPhone).toBe("052-123-4567");

    const blank = buildSimulation(input({ paymentDetails: { bankTransfer: "  " } }), NOW);
    expect(blank.paymentDetailsAreExample).toBe(true);
  });

  it("falls back to a full payment when the product offers no plan and dedupes duplicates", () => {
    const none = buildSimulation(input({ product: { ...input().product, paymentPlans: [] } }), NOW);
    expect(none.selectedPlan).toEqual({ kind: "full" });
    expect(none.remainingCents).toBe(0);
    expect(none.finalPaymentTrigger).toBe("none");

    const duplicated = buildSimulation(
      input({
        product: {
          ...input().product,
          paymentPlans: [
            { kind: "monthly", installments: 3 },
            { kind: "monthly", installments: 3 },
            { kind: "monthly", installments: 30 },
          ],
        },
      }),
      NOW,
    );
    expect(duplicated.planOptions).toHaveLength(1);
    expect(duplicated.selectedPlan).toEqual({ kind: "monthly", installments: 3 });
    expect(duplicated.finalPaymentTrigger).toBe("monthly");
    expect(duplicated.dueNowCents).toBe(60000);
  });

  it("never claims the artist is real", () => {
    expect(SIMULATION_LABEL).toBe("Simulation · Noya is not real");
    const model = buildSimulation(input({ producerName: "   " }), NOW);
    expect(model.producer.name).toBe("Your studio");
  });
});
