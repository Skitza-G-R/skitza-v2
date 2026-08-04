import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  PurchaseStatusCard,
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
  "declined",
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

  it("continues an approval into plan and exact-agreement review", () => {
    expect(pillForStage("awaiting_payment")).toEqual({
      label: "Request approved",
      tone: "amber",
    });
    expect(whatsNextForStage("awaiting_payment", "Gili Studio")).toEqual({
      line: "Gili Studio approved — choose a plan and review the agreement.",
      sub: "Your exact terms freeze only when you accept",
    });
    expect(HOME_SRC).toContain("caller.artist.purchase.payments()");
    expect(HOME_SRC).toContain(
      "withArtistStudio(`/artist/payments/${purchase.id}`, activeStudio.producerId)",
    );
  });

  it("does not offer a dead continuation when approved Store terms are unpublished", () => {
    expect(whatsNextForStage("awaiting_payment", "Gili Studio", false)).toEqual({
      line: "Gili Studio approved your request, but the offer is temporarily unavailable.",
      sub: "No terms have been accepted or frozen",
    });
    expect(HOME_SRC).not.toContain('stage === "awaiting_payment"');
    expect(HOME_SRC).not.toContain("continuationAvailable");
    expect(HOME_SRC).toContain('currentRequest.current?.status === "pending"');
  });

  it("preserves the request currency and minor units on Artist Home", () => {
    const markup = renderToStaticMarkup(
      createElement(PurchaseStatusCard, {
        stage: "paid",
        productName: "Mix package",
        priceCents: 12_345,
        currency: "USD",
        remainingCents: 2_345,
        producerName: "Gili Studio",
      }),
    );

    expect(markup).toContain("$123.45");
    expect(markup).toContain("$23.45");
    expect(markup).not.toContain("₪");
    expect(HOME_SRC).toContain(
      "formatPurchaseMoney(purchase.nextPayment.amountCents, purchase.currency)",
    );
  });

  it("keeps a decline generic and never accepts a private-reason prop", () => {
    expect(pillForStage("declined")).toEqual({
      label: "Couldn't be confirmed",
      tone: "neutral",
    });
    expect(whatsNextForStage("declined", "Gili Studio").line).toBe(
      "This request couldn't be confirmed. You're free to explore other offers.",
    );
    expect(SRC).not.toMatch(/declineReason|privateReason/);
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

  it("keeps accepted-purchase actions in the professional Home priority", () => {
    expect(HOME_SRC).toMatch(/caller\.artist\.purchase\.payments\(\)/);
    expect(HOME_SRC).toContain(
      ".filter((project) => project.producerId === activeStudio.producerId)",
    );
    expect(HOME_SRC).toContain(
      "if (!purchase.showPayNextPayment || !purchase.nextPayment) continue",
    );
    expect(HOME_SRC).toContain('kind: "payment_action"');
    expect(HOME_SRC).toContain('actionLabel: "View payment"');
    expect(HOME_SRC).toContain("<ProfessionalArtistHome");
    expect(HOME_SRC).not.toContain("<ArtistPaymentActionsCard");
  });

  it("keeps Sessions as distinct prioritized destinations", () => {
    expect(HOME_SRC).toContain("artistHomeBookingStatusActions({");
    expect(HOME_SRC).toContain("sessions: sessions.sessions");
    expect(HOME_SRC).toContain('kind: "ready_to_schedule"');
    expect(HOME_SRC).toMatch(
      /withArtistStudio\(\s*`\/artist\/book\?allowance=\$\{allowance\.sessionAllowanceId\}`,\s*activeStudio\.producerId,\s*\)/,
    );
    expect(HOME_SRC).not.toContain("<NextSessionCard");
    expect(HOME_SRC).not.toContain("<BookSessionTiles");
    expect(HOME_SRC).not.toMatch(/current\.projectId/);
  });

  it("has no messaging row or fake buttons (v1 has no messaging)", () => {
    expect(SRC).not.toMatch(/>\s*Message\s*</);
    expect(SRC).not.toMatch(/messageHref|messageAction/);
    expect(SRC).not.toMatch(/<button/);
  });

  it("renders the context CTA only when the page passes a real target (BE-2)", () => {
    // The handoff-S6 action (choose plan / book) is a real guarded link,
    // gated on actionHref so stages without an action render none.
    expect(SRC).toMatch(/actionHref && actionLabel \? \(/);
    expect(SRC).toMatch(/<OnlineRequiredLink/);
    expect(SRC).toContain("Reconnect to continue this purchase.");
  });
});
