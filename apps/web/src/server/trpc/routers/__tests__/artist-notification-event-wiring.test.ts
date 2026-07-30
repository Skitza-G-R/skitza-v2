import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const bookingSource = readFileSync(new URL("../booking.ts", import.meta.url), "utf8");
const artistSource = readFileSync(new URL("../artist.ts", import.meta.url), "utf8");
const projectSource = readFileSync(new URL("../project.ts", import.meta.url), "utf8");
const audioSource = readFileSync(new URL("../audio.ts", import.meta.url), "utf8");

function procedure(source: string, start: string, end: string): string {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex);
  expect(startIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(startIndex);
  return source.slice(startIndex, endIndex);
}

describe("artist notification event wiring", () => {
  it("resolves producer booking recipients through the exact purchase contact", () => {
    expect(bookingSource).toMatch(
      /eq\(clientContacts\.id, purchases\.clientContactId\)[\s\S]*eq\(clientContacts\.producerId, purchases\.producerId\)/,
    );
    expect(bookingSource).toMatch(
      /artistContactArchivedAt === null \? row\.artistClerkUserId : null/,
    );
  });

  it.each([
    ["confirm", "booking_confirmed"],
    ["reject", "booking_declined"],
    ["cancel", "booking_cancelled"],
  ] as const)("emits %s only after its committed transition", (name, kind) => {
    const next =
      name === "confirm" ? "reject:" : name === "reject" ? "cancel:" : "recordLateCancellation:";
    const source = procedure(
      bookingSource,
      `  ${name}: producerProcedure`,
      `  ${next} producerProcedure`,
    );
    expect(source).toMatch(/if \(result\.changed\) \{/);
    expect(source).toContain("emitArtistBookingNotificationBestEffort");
    expect(source).toContain(`"${kind}"`);
    expect(source.indexOf("if (result.changed)")).toBeGreaterThan(
      source.indexOf("SessionBooking(sessionBookingRepository(ctx.db)"),
    );
  });

  it("classifies a confirmed replacement as a changed booking", () => {
    const source = procedure(
      bookingSource,
      "  confirm: producerProcedure",
      "  reject: producerProcedure",
    );
    expect(source).toMatch(
      /rescheduledFromBookingId !== null[\s\S]*changed \? "booking_changed" : "booking_confirmed"/,
    );
  });

  it("emits self-serve events only for created, auto-confirmed sessions", () => {
    const confirm = procedure(
      artistSource,
      "  confirm: artistProcedure",
      "  mySessions: artistProcedure",
    );
    const reschedule = procedure(
      artistSource,
      "  reschedule: artistProcedure",
      "  // Payment belongs to Purchase",
    );
    for (const source of [confirm, reschedule]) {
      expect(source).toMatch(/if \(result\.created\)/);
      expect(source).toMatch(/result\.booking\.status === "confirmed"/);
      expect(source).toContain("emitArtistSessionNotificationBestEffort");
    }
    expect(confirm).toContain('kind: "booking_confirmed"');
    expect(reschedule).toContain('kind: "booking_changed"');
  });

  it("emits producer comments only after the exact comment and active contact exist", () => {
    const source = procedure(
      projectSource,
      "  addProducerComment: producerProcedure",
      "  // Sessions now point",
    );
    expect(source).toMatch(
      /eq\(clientContacts\.id, project\.clientContactId\)[\s\S]*isNull\(clientContacts\.archivedAt\)/,
    );
    expect(source.indexOf("emitArtistProducerCommentNotification")).toBeGreaterThan(
      source.indexOf(".insert(trackComments)"),
    );
    expect(source).toMatch(
      /emailEnabled = delivery\.emailEnabled[\s\S]*if \(!emailEnabled\) return/,
    );
    expect(source).toContain(
      "`${SITE_URL}/artist/music/song/${input.versionId}?comment=${row.id}`",
    );
  });

  it("emits a new-version event only after audio attachment and exact ownership resolution", () => {
    const complete = audioSource.slice(audioSource.indexOf("  completeMultipart:"));
    expect(complete.indexOf("emitArtistNewVersionNotification")).toBeGreaterThan(
      complete.indexOf("audioUrl: url"),
    );
    expect(complete).toMatch(
      /eq\(clientContacts\.id, projectRow\.clientContactId\)[\s\S]*eq\(clientContacts\.producerId, ctx\.producerId\)[\s\S]*isNull\(clientContacts\.archivedAt\)/,
    );
    expect(complete).toMatch(
      /emailEnabled = delivery\.emailEnabled[\s\S]*if \(!emailEnabled\) return[\s\S]*sendTrackVersionUploadedEmail/,
    );
    expect(complete).toContain(
      "reviewUrl: `${SITE_URL}/artist/music/song/${input.trackVersionId}`",
    );
  });
});
