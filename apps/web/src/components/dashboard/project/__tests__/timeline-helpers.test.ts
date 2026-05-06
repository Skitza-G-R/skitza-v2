import { describe, it, expect } from "vitest";

import { computeTimeline } from "../timeline-helpers";

describe("computeTimeline", () => {
  it("brand-new lead: all pending", () => {
    expect(
      computeTimeline({
        stage: "lead",
        chargesCompleted: 0,
        chargesTotal: 0,
        finalDelivered: false,
      }),
    ).toEqual([
      { label: "Trial", state: "pending" },
      { label: "In Progress", state: "pending" },
      { label: "Final", state: "pending" },
      { label: "Paid", state: "pending" },
    ]);
  });

  it("booked: Trial=done, In Progress=current", () => {
    const r = computeTimeline({
      stage: "booked",
      chargesCompleted: 0,
      chargesTotal: 0,
      finalDelivered: false,
    });
    expect(r[0]).toEqual({ label: "Trial", state: "done" });
    expect(r[1]).toEqual({ label: "In Progress", state: "current" });
  });

  it("in_production: In Progress=current, Final=pending", () => {
    const r = computeTimeline({
      stage: "in_production",
      chargesCompleted: 1,
      chargesTotal: 2,
      finalDelivered: false,
    });
    expect(r[1]).toEqual({ label: "In Progress", state: "current" });
    expect(r[2]).toEqual({ label: "Final", state: "pending" });
  });

  it("final delivered, not fully paid: Final=current, Paid=pending", () => {
    const r = computeTimeline({
      stage: "final_review",
      chargesCompleted: 1,
      chargesTotal: 2,
      finalDelivered: true,
    });
    expect(r[2]).toEqual({ label: "Final", state: "current" });
    expect(r[3]).toEqual({ label: "Paid", state: "pending" });
  });

  it("all charges complete: Paid=done", () => {
    const r = computeTimeline({
      stage: "paid",
      chargesCompleted: 3,
      chargesTotal: 3,
      finalDelivered: true,
    });
    expect(r[2]).toEqual({ label: "Final", state: "done" });
    expect(r[3]).toEqual({ label: "Paid", state: "done" });
  });

  it("chargesTotal=null (unknown plan) means Paid never marks done", () => {
    const r = computeTimeline({
      stage: "in_production",
      chargesCompleted: 0,
      chargesTotal: null,
      finalDelivered: false,
    });
    expect(r[3]).toEqual({ label: "Paid", state: "pending" });
  });

  it("archived: no step is current (absorbing state after paid)", () => {
    const r = computeTimeline({
      stage: "archived",
      chargesCompleted: 3,
      chargesTotal: 3,
      finalDelivered: true,
    });
    for (const step of r) {
      expect(step.state).not.toBe("current");
    }
  });

  it("chargesCompleted > chargesTotal (overpay/webhook race): Paid still done", () => {
    const r = computeTimeline({
      stage: "paid",
      chargesCompleted: 4,
      chargesTotal: 3,
      finalDelivered: true,
    });
    expect(r[3]?.state).toBe("done");
  });
});
