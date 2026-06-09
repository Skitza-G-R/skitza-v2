import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// Source-grep wiring tests for S12 (Session detail + cancel/reschedule).
// Matches the repo's existing screen-grep style (see commit-screens.test.ts
// and store-product-client.test.ts): we don't render — we assert the wiring
// that matters is present in the source. The pure policy helper itself is
// covered by book-data.test.ts (cancelPolicy is deterministic, `now` injected).

const here = dirname(fileURLToPath(import.meta.url));
const SCREEN_PATH = join(here, "..", "session-detail-screen.tsx");
const SHEET_PATH = join(here, "..", "reschedule-confirm-sheet.tsx");
const NOTICE_PATH = join(here, "..", "policy-notice.tsx");
const screenSrc = readFileSync(SCREEN_PATH, "utf8");
const sheetSrc = readFileSync(SHEET_PATH, "utf8");
const noticeSrc = readFileSync(NOTICE_PATH, "utf8");

describe("session-detail-screen.tsx (S12) wiring", () => {
  it("is a client component", () => {
    expect(screenSrc).toMatch(/^"use client";/);
  });

  it("mounts FunnelTopBar with onBack -> router.push('/artist/sessions')", () => {
    expect(screenSrc).toMatch(/<FunnelTopBar/);
    expect(screenSrc).toMatch(/title="Session"/);
    expect(screenSrc).toMatch(/router\.push\("\/artist\/sessions"\)/);
  });

  it("computes the policy from cancelPolicy with the runtime clock (Date.now)", () => {
    // The screen reads the live clock at render and injects it as nowMs.
    expect(screenSrc).toMatch(/const nowMs = Date\.now\(\)/);
    expect(screenSrc).toMatch(/cancelPolicy\(\s*[^)]*nowMs/s);
  });

  it("gates Reschedule + Cancel on policy.withinPolicy (disabled when false)", () => {
    expect(screenSrc).toMatch(/disabled=\{!policy\.withinPolicy/);
    // both the reschedule and cancel actions reference the gate
    const gateCount = screenSrc.match(/!policy\.withinPolicy/g) ?? [];
    expect(gateCount.length).toBeGreaterThanOrEqual(2);
  });

  it("shows the PolicyNotice (with the producer's name in the message reason) only when outside policy", () => {
    expect(screenSrc).toMatch(/<PolicyNotice/);
    expect(screenSrc).toMatch(/!policy\.withinPolicy.*<PolicyNotice/s);
    // The calm "message {Producer}" reason lives in policy-notice.tsx
    expect(noticeSrc).toMatch(/message \{producerName\}/);
    expect(noticeSrc).toMatch(/producerName/);
  });

  it("routes Reschedule to /artist/book (carrying the session id)", () => {
    expect(screenSrc).toMatch(/router\.push\(`\/artist\/book\?[^`]*session/);
  });

  it("designs an inline error state (role=alert), not a scary wall", () => {
    expect(screenSrc).toMatch(/role="alert"/);
    expect(screenSrc).toMatch(/setError/);
  });

  it("hides the actions on a past/done session and shows it has passed", () => {
    expect(screenSrc).toMatch(/This session has passed/);
    expect(screenSrc).toMatch(/status === "done"/);
  });

  it("renders the shared StatusPill", () => {
    expect(screenSrc).toMatch(/<StatusPill/);
  });

  it("cancel is a stub — no server mutation import (no tRPC / api caller)", () => {
    expect(screenSrc).not.toMatch(/from "~\/trpc/);
    expect(screenSrc).not.toMatch(/useMutation/);
    expect(screenSrc).not.toMatch(/\bapi\./);
  });
});

describe("reschedule-confirm-sheet.tsx wiring", () => {
  it("is a client component", () => {
    expect(sheetSrc).toMatch(/^"use client";/);
  });

  it("asks to confirm and names the producer as notified", () => {
    expect(sheetSrc).toMatch(/Cancel this session\?/);
    expect(sheetSrc).toMatch(/will be notified/);
    expect(sheetSrc).toMatch(/producerName/);
  });

  it("confirm is a stub (coming-soon pattern), not a real mutation", () => {
    expect(sheetSrc).not.toMatch(/useMutation/);
    expect(sheetSrc).not.toMatch(/from "~\/trpc/);
  });
});
