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
const PAGE_PATH = join(
  here,
  "..",
  "..",
  "..",
  "..",
  "app",
  "(artist)",
  "artist",
  "sessions",
  "[sessionId]",
  "page.tsx",
);
const ACTION_PATH = join(
  here,
  "..",
  "..",
  "..",
  "..",
  "app",
  "(artist)",
  "artist",
  "sessions",
  "actions.ts",
);
const screenSrc = readFileSync(SCREEN_PATH, "utf8");
const sheetSrc = readFileSync(SHEET_PATH, "utf8");
const noticeSrc = readFileSync(NOTICE_PATH, "utf8");
const pageSrc = readFileSync(PAGE_PATH, "utf8");
const actionSrc = readFileSync(ACTION_PATH, "utf8");

describe("session-detail-screen.tsx (S12) wiring", () => {
  it("is a client component", () => {
    expect(screenSrc).toMatch(/^"use client";/);
  });

  it("renders an in-flow, studio-preserving back link in the standing shell", () => {
    expect(screenSrc).toContain("Back to Sessions");
    expect(screenSrc).toContain('href={withArtistStudio("/artist/sessions", session.producerId)}');
    expect(screenSrc).not.toContain("<FunnelTopBar");
    expect(screenSrc).not.toContain("fixed inset-0");
  });

  it("uses the server-authored policy without recomputing the deadline in the browser", () => {
    expect(screenSrc).toMatch(/session\.policy\.canCancel/);
    expect(screenSrc).toMatch(/session\.policy\.canReschedule/);
    expect(screenSrc).not.toMatch(/Date\.now\(\)|cancelPolicy\(/);
  });

  it("shows only the actions allowed by the approved policy", () => {
    expect(screenSrc).toMatch(/session\.policy\.canReschedule \?/);
    expect(screenSrc).toMatch(/session\.policy\.canCancel \?/);
    expect(screenSrc).toMatch(/disabled=\{!online\}/);
    expect(screenSrc).not.toMatch(/disabled=\{!online \|\| !session\.policy/);
  });

  it("shows the PolicyNotice (with the producer's name in the message reason) only when outside policy", () => {
    expect(screenSrc).toMatch(/<PolicyNotice/);
    expect(screenSrc).toMatch(/isActive && !canChange[\s\S]*<PolicyNotice/);
    // The calm "message {Producer}" reason lives in policy-notice.tsx
    expect(noticeSrc).toMatch(/message \{producerName\}/);
    expect(noticeSrc).toMatch(/producerName/);
  });

  it("routes session changes into focused action screens", () => {
    expect(screenSrc).toContain("router.push(`/artist/sessions/${session.id}/reschedule`)");
    expect(screenSrc).toContain("router.push(`/artist/sessions/${session.id}/cancel`)");
  });

  it("hides actions for every terminal status and keeps the outcome visible", () => {
    expect(screenSrc).toMatch(/const isActive/);
    expect(screenSrc).toMatch(/status === "pending_approval"/);
    expect(screenSrc).toMatch(/status === "confirmed"/);
    expect(screenSrc).toMatch(/This booking is closed/);
    expect(screenSrc).toMatch(/outcome=\{session\.outcome\}/);
  });

  it("shows the exact Held-expiry explanation from the server reason", () => {
    expect(pageSrc).toMatch(/heldExpiryReason: row\.heldExpiryReason/);
    expect(screenSrc).toMatch(/heldExpiryReason: session\.heldExpiryReason/);
  });

  it("renders the shared StatusPill", () => {
    expect(screenSrc).toMatch(/<StatusPill/);
  });

  it("keeps the primary actions comfortably above a 44px touch target", () => {
    expect(screenSrc).toMatch(/py-4 text-\[16px\]/);
    expect(screenSrc).toMatch(/py-\[15px\] text-\[15px\]/);
  });
});

describe("reschedule-confirm-sheet.tsx wiring", () => {
  it("is a client component", () => {
    expect(sheetSrc).toMatch(/^"use client";/);
  });

  it("asks to send a request and explains that the producer decides", () => {
    expect(sheetSrc).toMatch(/Ask to cancel this session\?/);
    expect(sheetSrc).toMatch(/will review your request/);
    expect(sheetSrc).toMatch(/session and session credit stay in place/);
    expect(sheetSrc).toMatch(/producerName/);
  });

  it("calls the real idempotent cancel action", () => {
    expect(sheetSrc).toMatch(/cancelSessionAction/);
    expect(sheetSrc).toMatch(/operationKeyRef/);
    expect(sheetSrc).toMatch(/crypto\.randomUUID\(\)/);
    expect(actionSrc).toMatch(/caller\.artist\.book\.cancel\(input\)/);
  });
});

describe("Session detail route data", () => {
  it("loads the exact owned session and contains no mock fallback", () => {
    expect(pageSrc).toMatch(/caller\.artist\.book\.session\(\{ id: sessionId \}\)/);
    expect(pageSrc).not.toMatch(/MOCK_/);
    expect(pageSrc).toMatch(/cancellationDeadline\.toISOString\(\)/);
  });
});
