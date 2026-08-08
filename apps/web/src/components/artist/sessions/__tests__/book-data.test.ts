import { describe, expect, it } from "vitest";

import {
  allowanceBookHref,
  allowanceCanBook,
  allowanceUnavailableMessage,
  artistSessionDisplay,
  bookingActionLabel,
  buildProgressDots,
  formatSessionDate,
  formatSessionTime,
  formatSessionTimeZoneLabel,
  formatStudioTimeLine,
  formatShekels,
  groupSlotsByLocalDate,
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
    expect(bookingActionLabel(true)).toBe("Request this time");
  });

  it("books directly when Gate 3 is off (auto-approve)", () => {
    expect(bookingActionLabel(false)).toBe("Book this time");
  });
});

describe("artistSessionDisplay", () => {
  it("uses only the five approved artist labels", () => {
    expect(
      [
        ["pending_approval", "reserved"],
        ["confirmed", "reserved"],
        ["rejected", "reserved"],
        ["completed", "completed"],
        ["cancelled", "cancelled_on_time"],
      ].map(
        ([status, outcome]) =>
          artistSessionDisplay({ status: status as never, outcome: outcome as never }).label,
      ),
    ).toEqual(["Held", "Confirmed", "Declined", "Completed", "Cancelled"]);
  });

  it("maps no-show to Completed with secondary context", () => {
    expect(artistSessionDisplay({ status: "no_show", outcome: "no_show" })).toEqual({
      status: "completed",
      label: "Completed",
      secondary: "Marked no-show",
    });
  });

  it("explains an automatically expired Held request exactly", () => {
    expect(
      artistSessionDisplay({
        status: "cancelled",
        outcome: "cancelled_by_producer",
        heldExpiryReason: "approval_timeout",
      }),
    ).toEqual({
      status: "cancelled",
      label: "Cancelled",
      secondary: "The studio did not confirm this request in time.",
    });
  });
});

describe("artist-primary session timezone presentation", () => {
  it("formats an exact instant in any supplied IANA timezone", () => {
    const iso = "2026-06-09T14:30:00.000Z";
    expect(formatSessionDate(iso, "Asia/Jerusalem")).toBe("Tue, Jun 9");
    expect(formatSessionTime(iso, "Asia/Jerusalem")).toBe("5:30 PM");
    expect(formatSessionTime(iso, "America/New_York")).toBe("10:30 AM");
  });

  it("moves the calendar date when the selected local day has crossed midnight", () => {
    const iso = "2026-06-09T22:30:00.000Z";
    expect(formatSessionDate(iso, "Asia/Jerusalem")).toBe("Wed, Jun 10");
    expect(formatSessionTime(iso, "Asia/Jerusalem")).toBe("1:30 AM");
  });

  it("derives the date-correct IANA timezone offset", () => {
    const summer = "2026-08-10T06:00:00.000Z";
    const winter = "2026-12-10T07:00:00.000Z";

    expect(formatSessionTime(summer, "Asia/Jerusalem")).toBe("9:00 AM");
    expect(formatSessionTimeZoneLabel(summer, "Asia/Jerusalem")).toBe("Asia/Jerusalem · GMT+3");
    expect(formatSessionTime(winter, "Asia/Jerusalem")).toBe("9:00 AM");
    expect(formatSessionTimeZoneLabel(winter, "Asia/Jerusalem")).toBe("Asia/Jerusalem · GMT+2");
  });

  it("shows Studio time only when the Artist and Studio timezones differ", () => {
    const iso = "2026-06-09T22:30:00.000Z";

    expect(formatStudioTimeLine(iso, "Asia/Jerusalem", "Asia/Jerusalem")).toBeNull();
    expect(formatStudioTimeLine(iso, "America/New_York", "Asia/Jerusalem")).toBe(
      "Studio time · Wed, Jun 10 · 1:30 AM GMT+3",
    );
  });

  it("labels each repeated DST wall clock with its exact offset", () => {
    expect(formatSessionTimeZoneLabel("2026-11-01T05:30:00.000Z", "America/New_York")).toBe(
      "America/New_York · GMT-4",
    );
    expect(formatSessionTimeZoneLabel("2026-11-01T06:30:00.000Z", "America/New_York")).toBe(
      "America/New_York · GMT-5",
    );
  });

  it("regroups exact slots by Artist-local date without losing repeated DST instants", () => {
    const slots = groupSlotsByLocalDate(
      [
        {
          slots: [
            { startsAtISO: "2026-11-01T05:30:00.000Z", id: "earlier" },
            { startsAtISO: "2026-11-01T06:30:00.000Z", id: "later" },
          ],
        },
        {
          slots: [{ startsAtISO: "2026-11-02T01:30:00.000Z", id: "next-day" }],
        },
      ],
      "America/New_York",
    );

    expect(slots).toEqual([
      {
        date: "2026-11-01",
        slots: [
          { startsAtISO: "2026-11-01T05:30:00.000Z", id: "earlier" },
          { startsAtISO: "2026-11-01T06:30:00.000Z", id: "later" },
          { startsAtISO: "2026-11-02T01:30:00.000Z", id: "next-day" },
        ],
      },
    ]);
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
