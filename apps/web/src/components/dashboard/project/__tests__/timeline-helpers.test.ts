import { describe, it, expect } from "vitest";

import { computeTimeline } from "../timeline-helpers";

describe("computeTimeline", () => {
  it("brand-new lead: all pending except Trial=done if past-lead", () => {
    expect(
      computeTimeline({
        stage: "lead",
        contractSigned: false,
        chargesCompleted: 0,
        chargesTotal: 0,
        finalDelivered: false,
      }),
    ).toEqual([
      { label: "Trial", state: "pending" }, // still in lead, not past it
      { label: "Contract", state: "pending" },
      { label: "In Progress", state: "pending" },
      { label: "Final", state: "pending" },
      { label: "Paid", state: "pending" },
    ]);
  });

  it("booked, no contract yet: Trial=done, Contract=pending", () => {
    const r = computeTimeline({
      stage: "booked",
      contractSigned: false,
      chargesCompleted: 0,
      chargesTotal: 0,
      finalDelivered: false,
    });
    expect(r[0]).toEqual({ label: "Trial", state: "done" });
    expect(r[1]).toEqual({ label: "Contract", state: "pending" });
  });

  it("contract_sent, not signed: Contract=current", () => {
    const r = computeTimeline({
      stage: "contract_sent",
      contractSigned: false,
      chargesCompleted: 0,
      chargesTotal: 0,
      finalDelivered: false,
    });
    expect(r[1]).toEqual({ label: "Contract", state: "current" });
  });

  it("contract signed, mid-production: Contract=done, In Progress=current", () => {
    const r = computeTimeline({
      stage: "in_production",
      contractSigned: true,
      chargesCompleted: 1,
      chargesTotal: 2,
      finalDelivered: false,
    });
    expect(r[1]).toEqual({ label: "Contract", state: "done" });
    expect(r[2]).toEqual({ label: "In Progress", state: "current" });
    expect(r[3]).toEqual({ label: "Final", state: "pending" });
  });

  it("final delivered, not fully paid: Final=current, Paid=pending", () => {
    const r = computeTimeline({
      stage: "final_review",
      contractSigned: true,
      chargesCompleted: 1,
      chargesTotal: 2,
      finalDelivered: true,
    });
    expect(r[3]).toEqual({ label: "Final", state: "current" });
    expect(r[4]).toEqual({ label: "Paid", state: "pending" });
  });

  it("all charges complete: Paid=done", () => {
    const r = computeTimeline({
      stage: "paid",
      contractSigned: true,
      chargesCompleted: 3,
      chargesTotal: 3,
      finalDelivered: true,
    });
    expect(r[3]).toEqual({ label: "Final", state: "done" });
    expect(r[4]).toEqual({ label: "Paid", state: "done" });
  });

  it("chargesTotal=null (unknown plan) means Paid never marks done", () => {
    const r = computeTimeline({
      stage: "in_production",
      contractSigned: true,
      chargesCompleted: 0,
      chargesTotal: null,
      finalDelivered: false,
    });
    expect(r[4]).toEqual({ label: "Paid", state: "pending" });
  });

  it("cancelled: timeline reflects whatever state was reached, no step is 'current'", () => {
    const r = computeTimeline({
      stage: "cancelled",
      contractSigned: true,
      chargesCompleted: 1,
      chargesTotal: 2,
      finalDelivered: false,
    });
    // Contract=done (signed happened), In Progress not current (absorbing state)
    const contract = r[1];
    const inProgress = r[2];
    expect(contract?.state).toBe("done");
    expect(inProgress?.state).not.toBe("current");
  });

  it("archived: no step is current (absorbing state after paid)", () => {
    const r = computeTimeline({
      stage: "archived",
      contractSigned: true,
      chargesCompleted: 3,
      chargesTotal: 3,
      finalDelivered: true,
    });
    // Trial + Contract + In Progress + Final + Paid should all be "done" since
    // archived means the project completed fully. Not "current" on anything.
    for (const step of r) {
      expect(step.state).not.toBe("current");
    }
  });

  it("payment_paused: timeline reflects reached state, no step is 'current'", () => {
    const r = computeTimeline({
      stage: "payment_paused",
      contractSigned: true,
      chargesCompleted: 1,
      chargesTotal: 3,
      finalDelivered: false,
    });
    // Contract happened, so that step is done. In Progress should NOT be
    // "current" — dunning is an absorbing state until resumed.
    expect(r[1]?.state).toBe("done");
    for (const step of r) {
      expect(step.state).not.toBe("current");
    }
  });

  it("chargesCompleted > chargesTotal (overpay/webhook race): Paid still done", () => {
    const r = computeTimeline({
      stage: "paid",
      contractSigned: true,
      chargesCompleted: 4,  // over-paid by 1 — Stripe webhook double-fire, etc.
      chargesTotal: 3,
      finalDelivered: true,
    });
    expect(r[4]?.state).toBe("done");
  });
});
