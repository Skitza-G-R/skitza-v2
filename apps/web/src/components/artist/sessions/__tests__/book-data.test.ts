import { describe, expect, it } from "vitest";

import {
  allowanceBookHref,
  allowanceCanBook,
  allowanceUnavailableMessage,
  bookingActionLabel,
  buildProgressDots,
  formatSessionDate,
  formatSessionTime,
  formatShekels,
  progressMode,
} from "../book-data";

const fixedAllowance = {
  purchaseId: "purchase-1",
  sessionAllowanceId: "allowance-1",
  producerId: "producer-1",
  producerName: "Gili Studio",
  projectId: "project-1",
  projectTitle: "Debut",
  packageName: "Four sessions",
  kind: "fixed" as const,
  sessionLimit: 4,
  sessionsUsed: 2,
  sessionsRemaining: 2,
  durationMin: 120,
  locationType: "studio",
  bufferMinutes: 30,
  minLeadHours: 24,
  closedAtISO: null,
  canBook: true,
  bookingBlockedReason: null,
};

// Pure unit tests for the sessions helpers (no rendering). Mirrors the
// repo's existing pure-helper style (see purchase-data tests). Every
// helper takes its `now`/`today` injected — none read the runtime clock —
// so these assertions stay deterministic.

describe("progressMode", () => {
  it("returns 'count' when total is null (unlimited)", () => {
    expect(progressMode(null)).toBe("count");
  });

  it("returns 'dots' for small totals (<= 6)", () => {
    expect(progressMode(1)).toBe("dots");
    expect(progressMode(3)).toBe("dots");
    expect(progressMode(6)).toBe("dots");
  });

  it("returns 'bar' for larger totals (>= 7)", () => {
    expect(progressMode(7)).toBe("bar");
    expect(progressMode(12)).toBe("bar");
  });
});

describe("buildProgressDots", () => {
  it("returns one entry per total, the first `used` filled", () => {
    const dots = buildProgressDots(2, 4);
    expect(dots).toHaveLength(4);
    expect(dots.map((d) => d.filled)).toEqual([true, true, false, false]);
  });

  it("clamps used above total (never more filled than exist)", () => {
    const dots = buildProgressDots(9, 4);
    expect(dots).toHaveLength(4);
    expect(dots.every((d) => d.filled)).toBe(true);
  });

  it("clamps negative used to zero filled", () => {
    const dots = buildProgressDots(-3, 4);
    expect(dots).toHaveLength(4);
    expect(dots.every((d) => !d.filled)).toBe(true);
  });
});

describe("bookingActionLabel", () => {
  it("asks to request when Gate 3 (approval) is on", () => {
    expect(bookingActionLabel(true)).toBe("Request this slot");
  });

  it("books directly when Gate 3 is off (auto-approve)", () => {
    expect(bookingActionLabel(false)).toBe("Book this slot");
  });
});

describe("formatSessionDate / formatSessionTime (producer timezone)", () => {
  it("formats the same instant in the producer's IANA timezone", () => {
    const iso = "2026-06-09T14:30:00.000Z";
    expect(formatSessionDate(iso, "Asia/Jerusalem")).toBe("Tue, Jun 9");
    expect(formatSessionTime(iso, "Asia/Jerusalem")).toBe("5:30 PM");
    expect(formatSessionTime(iso, "America/New_York")).toBe("10:30 AM");
  });

  it("moves the calendar date when the producer's local day has crossed midnight", () => {
    const iso = "2026-06-09T22:30:00.000Z";
    expect(formatSessionDate(iso, "Asia/Jerusalem")).toBe("Wed, Jun 10");
    expect(formatSessionTime(iso, "Asia/Jerusalem")).toBe("1:30 AM");
  });
});

describe("formatShekels re-export", () => {
  it("re-exports the purchase-data formatter unchanged", () => {
    expect(formatShekels(240000)).toBe("₪2,400");
  });
});

describe("purchase-owned allowance links", () => {
  it("preserves the exact studio, project, and allowance identity", () => {
    expect(allowanceBookHref(fixedAllowance)).toBe(
      "/artist/book?studio=producer-1&project=project-1&allowance=allowance-1",
    );
  });

  it("blocks exhausted or closed fixed allowances but keeps unlimited open", () => {
    expect(allowanceCanBook(fixedAllowance)).toBe(true);
    expect(allowanceCanBook({ ...fixedAllowance, sessionsRemaining: 0 })).toBe(false);
    expect(allowanceCanBook({ ...fixedAllowance, canBook: false })).toBe(false);
    expect(allowanceCanBook({ ...fixedAllowance, closedAtISO: "2026-07-20T00:00:00Z" })).toBe(
      false,
    );
    expect(
      allowanceCanBook({
        ...fixedAllowance,
        kind: "unlimited",
        sessionLimit: null,
        sessionsRemaining: null,
      }),
    ).toBe(true);
  });

  it("explains paused, exhausted, and permanently closed allowances accurately", () => {
    expect(
      allowanceUnavailableMessage({
        ...fixedAllowance,
        canBook: false,
        bookingBlockedReason: "project_paused",
      }),
    ).toContain("Listening and comments stay available");
    expect(
      allowanceUnavailableMessage({
        ...fixedAllowance,
        sessionsRemaining: 0,
        canBook: false,
        bookingBlockedReason: "allowance_exhausted",
      }),
    ).toContain("new purchase");
    expect(
      allowanceUnavailableMessage({
        ...fixedAllowance,
        canBook: false,
        closedAtISO: "2026-07-20T00:00:00Z",
        bookingBlockedReason: "allowance_closed",
      }),
    ).toContain("permanently closed");
  });
});
