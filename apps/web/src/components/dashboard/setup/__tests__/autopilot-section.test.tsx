import { describe, it, expect } from "vitest";

import { SWITCHES } from "../autopilot-section";

// Autopilot ships at launch with only 2 of 5 toggles wired. Per PRD §15.1
// (locked Round 2, 2026-04-21): welcomeEmail + commentNotify fire today;
// the other 3 (unpaidReminder, requestTestimonial, autoArchive) are stubs
// — DB columns exist, but no cron + no trigger wired. Showing them
// active would erode trust when flipping ON does nothing. So they render
// disabled with a "Coming soon" badge until Phase 6 of the post-launch
// roadmap wires the cron jobs.
//
// These tests pin the launch scope via the exported SWITCHES array's
// `status` field. If someone wires a stub but forgets to flip the
// status, this test fails. If someone accidentally demotes a working
// toggle into stub mode, this test fails.
//
// Repo convention: no React Testing Library. Pin the data contract
// instead of rendered DOM. The component reads SWITCHES and renders
// accordingly — testing SWITCHES covers both "correct data" and
// "correct render" via the contract.

describe("Autopilot SWITCHES — launch gating (PRD §15.1)", () => {
  it("exposes exactly 5 toggle definitions", () => {
    expect(SWITCHES).toHaveLength(5);
  });

  it("marks exactly 2 toggles as active (welcomeEmail + commentNotify)", () => {
    const active = SWITCHES.filter((s) => s.status === "active");
    expect(active.map((s) => s.key).sort()).toEqual([
      "commentNotify",
      "welcomeEmail",
    ]);
  });

  it("marks exactly 3 toggles as coming_soon (the stubs)", () => {
    const comingSoon = SWITCHES.filter((s) => s.status === "coming_soon");
    expect(comingSoon.map((s) => s.key).sort()).toEqual([
      "autoArchive",
      "requestTestimonial",
      "unpaidReminder",
    ]);
  });

  it("every toggle has a non-empty label starting with a verb", () => {
    for (const s of SWITCHES) {
      expect(s.label.length).toBeGreaterThan(10);
      // First word of each label is a verb per UX convention in the
      // original comment block ("Send X", "Remind about Y", etc.).
      expect(s.label).toMatch(/^(Send|Remind|Ask|Ping|Auto-archive)/);
    }
  });

  it("every toggle has a descriptive helper sentence", () => {
    for (const s of SWITCHES) {
      expect(s.description.length).toBeGreaterThan(20);
    }
  });

  it("status field is always 'active' or 'coming_soon' (no other values)", () => {
    for (const s of SWITCHES) {
      expect(["active", "coming_soon"]).toContain(s.status);
    }
  });
});
