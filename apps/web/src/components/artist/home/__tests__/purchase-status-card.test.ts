import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  pillForStage,
  STEP_LABELS,
  stepStatesForStage,
  whatsNextForStage,
  type PurchaseStage,
} from "../purchase-status-card";

const SRC = readFileSync(join(__dirname, "../purchase-status-card.tsx"), "utf-8");
const HOME_SRC = readFileSync(join(__dirname, "../../../../app/(artist)/artist/page.tsx"), "utf-8");

const ALL_STAGES: PurchaseStage[] = [
  "pending_review",
  "awaiting_payment",
  "verifying",
  "paid",
  "delivered",
];

describe("PurchaseStatusCard (home heartbeat, S6)", () => {
  it("is a server component (no client interactivity)", () => {
    expect(SRC).not.toMatch(/^"use client"/m);
  });

  it("has a 4-node stepper: REQUEST → PAY → SESSIONS → DELIVERED", () => {
    expect(STEP_LABELS).toEqual(["Request", "Pay", "Sessions", "Delivered"]);
  });

  it("maps pending review to REQUEST active, rest upcoming", () => {
    expect(stepStatesForStage("pending_review")).toEqual([
      "active",
      "upcoming",
      "upcoming",
      "upcoming",
    ]);
  });

  it("maps BE-2 payment stages to REQUEST done, PAY active", () => {
    expect(stepStatesForStage("awaiting_payment")).toEqual([
      "done",
      "active",
      "upcoming",
      "upcoming",
    ]);
    expect(stepStatesForStage("verifying")).toEqual(["done", "active", "upcoming", "upcoming"]);
  });

  it("maps paid to SESSIONS active and delivered to all done", () => {
    expect(stepStatesForStage("paid")).toEqual(["done", "done", "active", "upcoming"]);
    expect(stepStatesForStage("delivered")).toEqual(["done", "done", "done", "done"]);
  });

  it("covers every handoff stage with a pill + what's-next line", () => {
    for (const stage of ALL_STAGES) {
      expect(pillForStage(stage).label.length).toBeGreaterThan(0);
      expect(whatsNextForStage(stage, "Gili Studio").line.length).toBeGreaterThan(0);
    }
  });

  it("shows the pending-review pill with the producer wait line", () => {
    expect(pillForStage("pending_review")).toEqual({
      label: "Pending review",
      tone: "amber",
    });
    expect(whatsNextForStage("pending_review", "Gili Studio")).toEqual({
      line: "Waiting for Gili Studio to review your request.",
      sub: "Usually within 24 hours",
    });
  });

  it("breathes the status dot and pulses the active node", () => {
    expect(SRC).toMatch(/sk-breathe/);
    expect(SRC).toMatch(/sk-pulse/);
  });

  it("states the one-booking-at-a-time rule", () => {
    expect(SRC).toMatch(/One booking at a time/);
    expect(SRC).toMatch(/fully paid/);
    expect(SRC).not.toMatch(/yours is in review/);
  });

  it("keeps the purchase lock visible after a deposit until the balance is zero", () => {
    expect(SRC).toMatch(/remainingCents/);
    expect(SRC).not.toMatch(/stage !== "paid"/);
  });

  it("lets a partially-paid artist make the next payment from home", () => {
    expect(HOME_SRC).toMatch(/current\.remainingCents > 0/);
    expect(HOME_SRC).toMatch(/current\.productId \?\? current\.id/);
    expect(HOME_SRC).toMatch(/Make next payment/);
    expect(HOME_SRC).toMatch(/pay\/instructions\?req=\$\{current\.id\}/);
  });

  it("has no messaging row or fake buttons (v1 has no messaging)", () => {
    expect(SRC).not.toMatch(/Message/);
    expect(SRC).not.toMatch(/<button/);
  });

  it("renders the context CTA only when the page passes a real target (BE-2)", () => {
    // The handoff-S6 action (choose plan / book) is a real <Link>, gated
    // on actionHref so stages without an action render none.
    expect(SRC).toMatch(/actionHref && actionLabel \? \(/);
    expect(SRC).toMatch(/<Link/);
  });
});
