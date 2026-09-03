import { describe, expect, it } from "vitest";

import { createInstallmentSchedule } from "~/server/domain/purchases/ledger";

import {
  buildSimulation,
  chooseStoryPlan,
  civilDateKey,
  nextWorkingDay,
  PREVIEW_SIMULATION_INPUT,
  SIMULATED_ARTIST,
  SIMULATION_IDS,
  SIMULATION_LABEL,
  simulatedCharges,
  zonedInstant,
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

    expect(model.frames.map((frame) => frame.id)).toEqual([
      "store",
      "approve",
      "agreement",
      "pay",
      "verify",
      "music",
      "sessions",
      "dashboard",
      "closing",
    ]);
    expect(model.frames.map((frame) => frame.step)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, null]);
    expect(model.frames.map((frame) => frame.side)).toEqual([
      "artist",
      "producer",
      "artist",
      "artist",
      "producer",
      "artist",
      "artist",
      "producer",
      "closing",
    ]);
    expect(model.frames.every((frame) => frame.caption.length > 0 && frame.detail.length > 0)).toBe(
      true,
    );
    expect(model.frames[0]?.detail).toContain("Signature production");
    expect(model.frames.find((frame) => frame.id === "pay")?.caption).toContain("₪900");
    // Only the two producer frames carry a real control that moves the story.
    expect(model.frames.filter((frame) => frame.interactive).map((frame) => frame.id)).toEqual([
      "approve",
      "verify",
    ]);
    expect(model.frames.at(-1)?.detail).toContain(SIMULATED_ARTIST.name);
  });

  it("drops the booking frame when the product includes no studio time", () => {
    const model = buildSimulation(
      input({ product: { ...PREVIEW_SIMULATION_INPUT.product, durationMin: 0, sessionCount: 0 } }),
      NOW,
    );

    expect(model.includesStudioTime).toBe(false);
    expect(model.frames.map((frame) => frame.id)).not.toContain("sessions");
    expect(model.frames.filter((frame) => frame.step !== null)).toHaveLength(7);
    expect(model.frames.map((frame) => frame.step)).toEqual([1, 2, 3, 4, 5, 6, 7, null]);
    expect(model.dashboard.todaySession).toBeNull();
    expect(model.request.snapshot.session).toBeNull();
  });

  it("builds her song with v2 waiting on approval and her note at 0:42", () => {
    const { song } = buildSimulation(input(), NOW);

    expect(song.data.track.title).toBe("Blue Hour");
    expect(song.data.selectedVersionId).toBe(SIMULATION_IDS.versionTwo);
    const v2 = song.data.versions.find((version) => version.id === SIMULATION_IDS.versionTwo);
    expect(v2?.producerMarkedFinalAtIso).not.toBeNull();
    expect(v2?.artistApprovedAtIso).toBeNull();
    expect(v2?.peaks).toHaveLength(200);
    expect(v2?.delivery.permission).toBe("payment_required");
    // Every version ships its own peaks, so the waveform never fetches audio.
    expect(song.data.versions.every((version) => (version.peaks ?? []).length === 200)).toBe(true);
    expect(song.data.versions.every((version) => version.audioUrl?.startsWith("data:"))).toBe(true);

    expect(song.data.comments).toHaveLength(2);
    expect(
      song.data.comments.every((comment) => comment.versionId === SIMULATION_IDS.versionTwo),
    ).toBe(true);
    expect(song.data.comments[0]).toMatchObject({ timeMs: 42_000, fromProducer: false });
    expect(song.data.comments[0]?.authorName).toBe(SIMULATED_ARTIST.name);
    expect(song.data.comments[1]).toMatchObject({ timeMs: 42_000, fromProducer: true });

    expect(song.approved.track.artistApprovalLocked).toBe(true);
    expect(
      song.approved.versions.find((version) => version.id === SIMULATION_IDS.versionTwo)
        ?.artistApprovedAtIso,
    ).toBe(NOW.toISOString());
  });

  it("unlocks downloads on the song when the story is paid in full", () => {
    const model = buildSimulation(
      input({ product: { ...PREVIEW_SIMULATION_INPUT.product, paymentPlans: [{ kind: "full" }] } }),
      NOW,
    );

    expect(model.remainingCents).toBe(0);
    expect(model.song.data.versions[0]?.delivery.permission).toBe("purchase_fully_paid");
    expect(model.dashboard.paymentBalances).toEqual([]);
  });

  it("books the next working day at 14:00 in the studio's own zone", () => {
    const model = buildSimulation(input(), NOW);

    // NOW is Wednesday 12:00 in Jerusalem, so the story books Thursday.
    expect(model.session.item.startsAtISO).toBe("2026-09-03T11:00:00.000Z");
    expect(model.session.item.status).toBe("confirmed");
    expect(model.session.item.durationMin).toBe(60);
    expect(model.session.item.changeRequest).toBeNull();
    expect(model.session.allowance.sessionsRemaining).toBe(2);
    expect(model.session.nowISO).toBe(NOW.toISOString());

    expect(model.booking.availability.days).toHaveLength(4);
    expect(model.booking.availability.days[0]?.date).toBe("2026-09-03");
    expect(model.booking.availability.days[0]?.slots).toHaveLength(5);
    expect(model.booking.availability.today).toBe("2026-09-02");
    expect(model.booking.activePackages[0]?.sessionsRemaining).toBe(3);
    expect(model.booking.allowanceId).toBe(SIMULATION_IDS.allowance);

    // Thursday evening rolls past the Friday and Saturday weekend to Sunday.
    const thursday = buildSimulation(input(), new Date("2026-09-03T09:00:00.000Z"));
    expect(thursday.session.item.startsAtISO).toBe("2026-09-06T11:00:00.000Z");
    expect(thursday.booking.availability.days.map((day) => day.date)).toEqual([
      "2026-09-06",
      "2026-09-07",
      "2026-09-08",
      "2026-09-09",
    ]);
  });

  it("reads the studio's own time zone", () => {
    const newYork = buildSimulation(input({ timezone: "America/New_York" }), NOW);
    // 14:00 in New York on 3 September is 18:00 UTC.
    expect(newYork.session.item.startsAtISO).toBe("2026-09-03T18:00:00.000Z");
    expect(newYork.session.item.artistTimezone).toBe("America/New_York");
    expect(civilDateKey(nextWorkingDay(NOW, "America/New_York"))).toBe("2026-09-03");
    expect(
      zonedInstant({
        year: 2026,
        month: 9,
        day: 3,
        hour: 14,
        timeZone: "Asia/Jerusalem",
      }).toISOString(),
    ).toBe("2026-09-03T11:00:00.000Z");
  });

  it("wakes the producer dashboard up with the story's own numbers", () => {
    const { dashboard } = buildSimulation(input(), NOW);

    expect(dashboard.pulseStats).toEqual({
      commercialAvailable: true,
      thisMonthCents: 90000,
      outstandingCents: 90000,
      currency: "ILS",
      activeProjects: 1,
    });
    expect(dashboard.todaySession?.occurredAt.toISOString()).toBe("2026-09-03T11:00:00.000Z");
    // The frame sits on the morning of her session, so the live "Today" card
    // on the dashboard is accurate rather than three days early.
    expect(dashboard.now.toISOString()).toBe("2026-09-03T05:00:00.000Z");
    expect(dashboard.recentUploads[0]?.versionLabel).toBe("v2");
    expect(dashboard.recentUploads[0]?.projectClientName).toBe(SIMULATED_ARTIST.name);
    expect(dashboard.paymentBalances[0]?.clientName).toBe(SIMULATED_ARTIST.name);
  });

  it("describes her request as a proposal on the product's real terms", () => {
    const { request } = buildSimulation(input(), NOW);

    expect(request.snapshot.selectedPaymentPlan).toBeNull();
    expect(request.snapshot.offeredPaymentPlans).toEqual([{ kind: "split_50_50" }, { kind: "full" }]);
    expect(request.snapshot.totalCents).toBe(180000);
    expect(request.snapshot.deliverables).toEqual(["Production", "Mix", "Master"]);
    expect(request.snapshot.session).toEqual({
      limit: { kind: "fixed", count: 3 },
      durationMin: 60,
      locationType: "Studio",
      bufferMinutes: 30,
      minLeadHours: 24,
    });
    expect(request.totalLabel).toBe("₪1,800");
    expect(request.submittedAtLabel.length).toBeGreaterThan(0);
    expect(request.artistEmail).toContain("skitza.invalid");
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
