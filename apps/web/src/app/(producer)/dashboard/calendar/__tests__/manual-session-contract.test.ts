import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const routerSource = readFileSync(
  new URL("../../../../../server/trpc/routers/booking.ts", import.meta.url),
  "utf8",
);
const artistRouterSource = readFileSync(
  new URL("../../../../../server/trpc/routers/artist.ts", import.meta.url),
  "utf8",
);
const manualUi = readFileSync(new URL("../manual-session-modal.tsx", import.meta.url), "utf8");
const calendarActions = readFileSync(new URL("../calendar-actions.ts", import.meta.url), "utf8");
const decisionUi = readFileSync(new URL("../change-request-decision.tsx", import.meta.url), "utf8");
const rescheduleUi = readFileSync(
  new URL("../reschedule-session-modal.tsx", import.meta.url),
  "utf8",
);

function between(source: string, start: string, end: string): string {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  expect(from).toBeGreaterThanOrEqual(0);
  expect(to).toBeGreaterThan(from);
  return source.slice(from, to);
}

describe("producer manual session contract", () => {
  it("keeps manual options, preview, and create producer-only and server-derived", () => {
    const manualRouter = between(routerSource, "  manual: router({", "  reschedule: router({");
    const createRouter = manualRouter.slice(manualRouter.indexOf("    create: producerProcedure"));
    expect(manualRouter.match(/producerProcedure/g)?.length).toBe(3);
    expect(manualRouter).toContain("createProducerManualSessionBooking(");
    expect(manualRouter).toContain("previewProducerManualSession(");
    expect(createRouter.indexOf("findProducerManualSessionBookingReplay(")).toBeGreaterThanOrEqual(
      0,
    );
    expect(createRouter.indexOf("findProducerManualSessionBookingReplay(")).toBeLessThan(
      createRouter.indexOf("previewProducerManualSession("),
    );
    expect(manualRouter).toContain("clientId: z.string().uuid()");
    expect(manualRouter).toContain("projectId: z.string().uuid()");
    for (const forbidden of [
      "artistEmail: z.",
      "productId: z.",
      "durationMin: z.",
      "location: z.",
      "notes: z.",
      "participants: z.",
      "price: z.",
    ]) {
      expect(manualRouter).not.toContain(forbidden);
    }
    expect(manualRouter).toContain("deliverCalendarJobAfterResponse");
  });

  it("shows the short responsive form and warning confirmation", () => {
    expect(manualUi).toContain("Choose an existing client and project");
    expect(manualUi).toContain("fixed by this project’s package");
    expect(manualUi).toContain('side="right"');
    expect(manualUi).toContain("Book a session");
    expect(manualUi).toContain('label="Client"');
    expect(manualUi).toContain('label="Project"');
    expect(manualUi).toContain("Edit title");
    expect(manualUi).toContain("Payment due");
    expect(manualUi).toContain("onDraftChange");
    expect(manualUi).toContain("reveal-up-delay-2");
    expect(manualUi).not.toContain("sm:grid-cols-2");
    expect(manualUi).toContain("multiple session packages");
    expect(manualUi).toContain("Check these warnings");
    expect(manualUi).toContain("Create anyway");
    expect(calendarActions).toContain('"GOOGLE_BUSY"');
    expect(manualUi).toContain("Review these availability warnings before creating the session.");
    expect(manualUi).toMatch(
      /result\.preview\.warnings\.length > 0 \|\|\s*protectionFrom\(result\.preview\) === "reduced"/,
    );
    expect(manualUi).toContain('protectionFrom(result.session) === "reduced"');
    expect(manualUi).toContain("h-11");
    expect(manualUi).not.toMatch(/Google Meet|participant|recurrence/i);
  });
});

describe("session change request contract", () => {
  it("stores artist intent and leaves the booking unchanged until a producer decision", () => {
    const cancel = between(
      artistRouterSource,
      "  cancel: artistProcedure",
      "  reschedule: artistProcedure",
    );
    const reschedule = between(
      artistRouterSource,
      "  reschedule: artistProcedure",
      "  // Payment belongs to Purchase",
    );
    expect(cancel).toContain('before.booking.status === "pending_approval"');
    expect(cancel).toContain("cancelArtistSessionBooking(");
    expect(cancel).toContain("submitArtistSessionChangeRequest(");
    expect(cancel).toContain('kind: "cancel"');
    expect(reschedule).toContain("submitArtistSessionChangeRequest(");
    expect(reschedule).toContain('kind: "reschedule"');
    expect(cancel).toContain('status: "request_sent"');
    expect(cancel).toContain('status: "cancelled"');
    expect(reschedule).toContain('status: "request_sent"');
  });

  it("gives the producer clear approve/decline and reschedule warning controls", () => {
    expect(decisionUi).toContain("The current session stays unchanged unless you approve.");
    expect(decisionUi).toContain("Decline");
    expect(decisionUi).toContain("Approve");
    expect(calendarActions).toContain("googleCalendarProtection: result.googleCalendarProtection");
    expect(decisionUi).toContain('request.kind === "reschedule"');
    expect(decisionUi).toContain('result.googleCalendarProtection === "reduced"');
    expect(decisionUi).toContain(
      "Artist request approved. Google busy-time protection was limited for this check.",
    );
    expect(decisionUi).toContain('reducedProtection ? "info" : "success"');
    expect(decisionUi).toContain("h-11");
    expect(rescheduleUi).toContain("The duration and billing treatment");
    expect(rescheduleUi).toContain("Check these warnings");
    expect(rescheduleUi).toContain("Reschedule anyway");
    expect(rescheduleUi).toContain("GoogleBusyProtectionWarning");
    expect(rescheduleUi).toMatch(
      /result\.preview\.warnings\.length > 0 \|\|\s*result\.preview\.googleCalendarProtection === "reduced"/,
    );
    expect(rescheduleUi).toContain(
      "This time does not overlap another Skitza session, but Google busy times could not be checked.",
    );
    expect(rescheduleUi).toContain("warning.code as ManualWarningCode");
    expect(calendarActions).toContain("googleCalendarProtection: result.googleCalendarProtection");
    expect(rescheduleUi).toContain('result.googleCalendarProtection === "reduced"');
    expect(rescheduleUi).toContain("Google busy-time protection was limited for this check");
    expect(rescheduleUi).toContain("h-11");
  });
});
