import { describe, expect, it } from "vitest";

import {
  buildSessionCalendarIcs,
  escapeCalendarText,
  foldCalendarContentLine,
  type SessionCalendarPayload,
} from "./ics";

function payload(overrides: Partial<SessionCalendarPayload> = {}): SessionCalendarPayload {
  return {
    schemaVersion: 1,
    method: "REQUEST",
    uid: "skitza-use-42@skitza.app",
    sequence: 3,
    dtstampUtc: "2026-08-08T10:11:12.345Z",
    startsAtUtc: "2026-10-25T00:30:00.000Z",
    endsAtUtc: "2026-10-25T01:30:00.000Z",
    summary: "Mix review",
    description: "A confirmed Skitza session.",
    organizer: { name: "Gili Producer", email: "gili@skitza.app" },
    attendee: { name: "Ari Artist", email: "ari@example.com" },
    ...overrides,
  };
}

describe("buildSessionCalendarIcs", () => {
  it("builds a deterministic UTC REQUEST with the stable identity and revision", () => {
    const ics = buildSessionCalendarIcs(payload());
    const unfolded = ics.replace(/\r\n[ \t]/gu, "");

    expect(ics).toContain("\r\nMETHOD:REQUEST\r\n");
    expect(ics).toContain("\r\nUID:skitza-use-42@skitza.app\r\n");
    expect(ics).toContain("\r\nSEQUENCE:3\r\n");
    expect(ics).toContain("\r\nDTSTAMP:20260808T101112Z\r\n");
    expect(ics).toContain("\r\nDTSTART:20261025T003000Z\r\n");
    expect(ics).toContain("\r\nDTEND:20261025T013000Z\r\n");
    expect(ics).toContain("\r\nSTATUS:CONFIRMED\r\n");
    expect(unfolded).toContain(
      '\r\nATTENDEE;CN="Ari Artist";ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:ari@example.com\r\n',
    );
    expect(ics.endsWith("\r\n")).toBe(true);
    expect(ics.replaceAll("\r\n", "")).not.toContain("\n");
  });

  it("uses CANCEL and CANCELLED without changing the UID", () => {
    const ics = buildSessionCalendarIcs(payload({ method: "CANCEL", sequence: 4 }));

    expect(ics).toContain("\r\nMETHOD:CANCEL\r\n");
    expect(ics).toContain("\r\nSTATUS:CANCELLED\r\n");
    expect(ics).toContain("\r\nUID:skitza-use-42@skitza.app\r\n");
    expect(ics).toContain("\r\nSEQUENCE:4\r\n");
    expect(ics.replace(/\r\n[ \t]/gu, "")).toContain(
      '\r\nATTENDEE;CN="Ari Artist";ROLE=REQ-PARTICIPANT:mailto:ari@example.com\r\n',
    );
    expect(ics).not.toContain("RSVP=TRUE");
  });

  it("escapes text and parameter values without allowing content-line injection", () => {
    const ics = buildSessionCalendarIcs(
      payload({
        summary: "Mix, master; stems \\ final\r\nX-FAKE:injected",
        description: "Line one\nLine two",
        organizer: { name: 'Gili ^ "Ace"\nProducer', email: "gili@skitza.app" },
      }),
    );
    const unfolded = ics.replace(/\r\n[ \t]/gu, "");

    expect(unfolded).toContain("SUMMARY:Mix\\, master\\; stems \\\\ final\\nX-FAKE:injected\r\n");
    expect(unfolded).toContain("DESCRIPTION:Line one\\nLine two\r\n");
    expect(unfolded).toContain("ORGANIZER;CN=\"Gili ^^ ^'Ace^'^nProducer\":mailto:");
    expect(unfolded).not.toContain("\r\nX-FAKE:injected");
  });

  it("folds long UTF-8 content at 75 octets without splitting a code point", () => {
    const original = `SUMMARY:${"🎛️ mix ".repeat(30)}`;
    const folded = foldCalendarContentLine(original);
    const physicalLines = folded.split("\r\n");

    expect(physicalLines.length).toBeGreaterThan(1);
    for (const line of physicalLines) {
      expect(new TextEncoder().encode(line).byteLength).toBeLessThanOrEqual(75);
    }
    expect(folded.replace(/\r\n[ \t]/gu, "")).toBe(original);
  });

  it("rejects invalid UTC dates, ranges, revisions, and mailto injection", () => {
    expect(() =>
      buildSessionCalendarIcs(payload({ startsAtUtc: "2026-08-08T10:00:00+03:00" })),
    ).toThrow("Invalid calendar DTSTART");
    expect(() =>
      buildSessionCalendarIcs(payload({ endsAtUtc: "2026-10-25T00:30:00.000Z" })),
    ).toThrow("Calendar DTEND must be after DTSTART");
    expect(() =>
      buildSessionCalendarIcs(payload({ startsAtUtc: "2026-02-30T10:00:00.000Z" })),
    ).toThrow("Invalid calendar DTSTART");
    expect(() => buildSessionCalendarIcs(payload({ sequence: -1 }))).toThrow(
      "Invalid calendar sequence",
    );
    expect(() =>
      buildSessionCalendarIcs(
        payload({ attendee: { name: "Ari", email: "ari@example.com\r\nBCC:evil@example.com" } }),
      ),
    ).toThrow("Invalid calendar attendee email");
    expect(() =>
      buildSessionCalendarIcs(payload({ summary: `Mix${String.fromCharCode(1)}review` })),
    ).toThrow("Invalid calendar summary");
  });
});

describe("escapeCalendarText", () => {
  it("escapes RFC5545 TEXT delimiters in the required order", () => {
    expect(escapeCalendarText("a\\b,c;d\ne")).toBe("a\\\\b\\,c\\;d\\ne");
  });
});
