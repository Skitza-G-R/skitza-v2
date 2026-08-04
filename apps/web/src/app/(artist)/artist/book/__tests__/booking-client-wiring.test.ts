import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const pageSrc = readFileSync(join(here, "..", "page.tsx"), "utf8");
const clientSrc = readFileSync(join(here, "..", "booking-client.tsx"), "utf8");
const actionsSrc = readFileSync(join(here, "..", "actions.ts"), "utf8");

describe("artist Book server wiring", () => {
  it("authorizes studios, packages, reschedule context, and exact allowance availability", () => {
    expect(pageSrc).toMatch(/caller\.artist\.studios\(\)/);
    expect(pageSrc).toMatch(/caller\.artist\.book\.activePackages/);
    expect(pageSrc).toMatch(/caller\.artist\.book\.availability/);
    expect(pageSrc).toMatch(/caller\.artist\.book\.session\(\{ id: sp\.session \}\)/);
    expect(pageSrc).toMatch(/sessionAllowanceId: initialSessionAllowanceId/);
    expect(pageSrc).toMatch(/bookingId: rescheduleSession\.id/);
  });

  it("locks reschedule to the original purchase-owned allowance", () => {
    expect(pageSrc).toMatch(
      /row\.sessionAllowanceId === rescheduleSession\.sessionAllowanceId/,
    );
  });

  it("serializes server-authored exact instants before the client boundary", () => {
    expect(pageSrc).toMatch(/startsAtISO: slot\.startsAt\.toISOString\(\)/);
    expect(pageSrc).toMatch(/endsAtISO: slot\.endsAt\.toISOString\(\)/);
  });
});

describe("focused short booking process", () => {
  it("does not trap the fixed frame inside a transformed reveal wrapper", () => {
    expect(pageSrc).toMatch(
      /<div className="mx-auto w-full max-w-\[480px\] space-y-5">/,
    );
    expect(pageSrc).not.toMatch(
      /<div className="reveal-up mx-auto w-full max-w-\[480px\] space-y-5">/,
    );
  });

  it("uses a focused overlay and package → day → time → review steps", () => {
    expect(clientSrc).toMatch(/type Step = "package" \| "day" \| "time" \| "review"/);
    expect(clientSrc).toMatch(/fixed inset-0 z-\[60\]/);
    expect(clientSrc).toMatch(/<FunnelTopBar/);
  });

  it("starts with next available days and reveals the calendar only on request", () => {
    expect(clientSrc).toMatch(/days\.slice\(0, 4\)/);
    expect(clientSrc).toMatch(/More dates/);
    expect(clientSrc).toMatch(/showCalendar \? <MonthCalendar/);
  });

  it("has no booking-flow studio picker", () => {
    expect(clientSrc).not.toMatch(/ProducerPicker/);
    expect(clientSrc).not.toMatch(/handleSwitchStudio/);
  });

  it("shows artist time and secondary studio time only when zones differ", () => {
    expect(clientSrc).toMatch(/artistTimeZone/);
    expect(clientSrc).toMatch(/studioTimeZone/);
    expect(clientSrc).toMatch(/zonesDiffer/);
    expect(clientSrc).toMatch(/Studio time/);
    expect(clientSrc).toMatch(/formatGmtClockTime\(new Date\(iso\), timeZone\)/);
    expect(clientSrc).not.toMatch(/timeZoneName: "short"/);
  });

  it("uses the approved final booking labels", () => {
    expect(clientSrc).toMatch(/bookingActionLabel\(!selectedPackage\.autoConfirm\)/);
    expect(clientSrc).toMatch(/Reschedule to this time/);
  });
});

describe("exact booking commands", () => {
  it("submits the exact UTC instant and owned purchase identity", () => {
    expect(clientSrc).toMatch(/startsAt: selectedSlot\.startsAtISO/);
    expect(clientSrc).toMatch(/projectId: selectedPackage\.projectId/);
    expect(clientSrc).toMatch(/purchaseId: selectedPackage\.purchaseId/);
    expect(clientSrc).toMatch(/sessionAllowanceId: selectedPackage\.sessionAllowanceId/);
    expect(clientSrc).toMatch(/durationMin: selectedPackage\.durationMin/);
    expect(clientSrc).not.toMatch(/startMin: selected/);
    expect(clientSrc).not.toMatch(/block: selected/);
  });

  it("converts the ISO string back to a Date inside each server action", () => {
    expect(actionsSrc).toMatch(/startsAt: new Date\(input\.startsAt\)/);
  });

  it("uses a durable operation key and the atomic reschedule command", () => {
    expect(clientSrc).toMatch(/operationKey\.current \?\?= crypto\.randomUUID\(\)/);
    expect(clientSrc).toMatch(/rescheduleBookingAction/);
    expect(clientSrc).toMatch(/id: rescheduleSessionId/);
  });

  it("lands on the exact created replacement or booking", () => {
    expect(clientSrc).toMatch(
      /router\.push\(withArtistStudio\(`\/artist\/sessions\?just=\$\{response\.id\}`/,
    );
  });
});
