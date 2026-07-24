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

  it("mounts FunnelTopBar with a studio-preserving back route", () => {
    expect(screenSrc).toMatch(/<FunnelTopBar/);
    expect(screenSrc).toMatch(/title="Session"/);
    expect(screenSrc).toContain(
      'router.push(withArtistStudio("/artist/sessions", session.producerId))',
    );
  });

  it("uses the server-authored policy without recomputing the deadline in the browser", () => {
    expect(screenSrc).toMatch(/session\.policy\.canCancel/);
    expect(screenSrc).toMatch(/session\.policy\.canReschedule/);
    expect(screenSrc).not.toMatch(/Date\.now\(\)|cancelPolicy\(/);
  });

  it("gates Reschedule + Cancel independently on the approved policy", () => {
    expect(screenSrc).toMatch(/disabled=\{!online \|\| !session\.policy\.canReschedule\}/);
    expect(screenSrc).toMatch(/disabled=\{!online \|\| !session\.policy\.canCancel\}/);
  });

  it("shows the PolicyNotice (with the producer's name in the message reason) only when outside policy", () => {
    expect(screenSrc).toMatch(/<PolicyNotice/);
    expect(screenSrc).toMatch(/isActive && !canChange[\s\S]*<PolicyNotice/);
    // The calm "message {Producer}" reason lives in policy-notice.tsx
    expect(noticeSrc).toMatch(/message \{producerName\}/);
    expect(noticeSrc).toMatch(/producerName/);
  });

  it("routes Reschedule to /artist/book (carrying the session id)", () => {
    expect(screenSrc).toMatch(/session: session\.id/);
    expect(screenSrc).toMatch(/allowance: session\.sessionAllowanceId/);
    expect(screenSrc).toMatch(/router\.push\(`\/artist\/book\?\$\{params\.toString\(\)\}`\)/);
  });

  it("hides actions for every terminal status and keeps the outcome visible", () => {
    expect(screenSrc).toMatch(/const isActive/);
    expect(screenSrc).toMatch(/status === "pending_approval"/);
    expect(screenSrc).toMatch(/status === "confirmed"/);
    expect(screenSrc).toMatch(/This booking is closed/);
    expect(screenSrc).toMatch(/outcome=\{session\.outcome\}/);
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

  it("asks to confirm and names the producer as notified", () => {
    expect(sheetSrc).toMatch(/Cancel this session\?/);
    expect(sheetSrc).toMatch(/will be notified/);
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
