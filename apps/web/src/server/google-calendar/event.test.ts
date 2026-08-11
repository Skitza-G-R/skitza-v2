import { randomBytes } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  GoogleCalendarEventValidationError,
  buildGoogleCalendarEventWrite,
  deriveGoogleCalendarEventId,
  isValidGoogleCalendarEventId,
} from "./event";

const SECRET = randomBytes(32);
const EVENT_ID = deriveGoogleCalendarEventId({
  producerId: "producer-id",
  linkKey: "booking-calendar-link-id",
  secret: SECRET,
});
const BASE = {
  eventId: EVENT_ID,
  startsAt: new Date("2026-08-10T09:00:00.000Z"),
  endsAt: new Date("2026-08-10T10:30:00.000Z"),
  revision: 3,
  opaqueLink: "uHC39zNK5cAvF8GJpM5C8Q",
} as const;

describe("Google Calendar approved event mapping", () => {
  it("derives a stable opaque client event ID accepted by Google", () => {
    const again = deriveGoogleCalendarEventId({
      producerId: "producer-id",
      linkKey: "booking-calendar-link-id",
      secret: SECRET,
    });
    const otherBooking = deriveGoogleCalendarEventId({
      producerId: "producer-id",
      linkKey: "new-link-created-for-switched-account",
      secret: SECRET,
    });

    expect(again).toBe(EVENT_ID);
    expect(otherBooking).not.toBe(EVENT_ID);
    expect(isValidGoogleCalendarEventId(EVENT_ID)).toBe(true);
    expect(EVENT_ID).not.toContain("booking-calendar-link-id");
  });

  it("builds a private opaque hold with no attendee or private booking details", () => {
    const event = buildGoogleCalendarEventWrite({ ...BASE, kind: "hold" });

    expect(event).toEqual({
      eventId: EVENT_ID,
      kind: "hold",
      attendeeMode: "clear",
      body: {
        summary: "Reserved",
        start: { dateTime: "2026-08-10T09:00:00.000Z", timeZone: "UTC" },
        end: { dateTime: "2026-08-10T10:30:00.000Z", timeZone: "UTC" },
        visibility: "private",
        transparency: "opaque",
        attendees: [],
        extendedProperties: {
          private: {
            skitzaLink: "uHC39zNK5cAvF8GJpM5C8Q",
            skitzaRevision: "3",
            skitzaSchema: "1",
          },
        },
        guestsCanInviteOthers: false,
        guestsCanModify: false,
        guestsCanSeeOtherGuests: false,
        reminders: { useDefault: false },
      },
    });
    expect(JSON.stringify(event)).not.toContain("producer-id");
    expect(JSON.stringify(event)).not.toContain("booking-calendar-link-id");
  });

  it("builds a confirmed event with both participants and a short safe description", () => {
    const event = buildGoogleCalendarEventWrite({
      ...BASE,
      kind: "confirmed",
      attendeeMode: "set_participants",
      summary: " Vocal production ",
      participants: [
        { email: " Producer@Example.com ", displayName: " Producer Name " },
        { email: " Artist@Example.com ", displayName: " Artist Name " },
      ],
      artistSafeSessionUrl: "https://skitza.app/artist/sessions/session_123",
    });

    expect(event.body).toMatchObject({
      summary: "Vocal production",
      description:
        "Skitza studio session: Vocal production\n\nBooking details: https://skitza.app/artist/sessions/session_123",
      attendees: [
        { email: "producer@example.com", displayName: "Producer Name" },
        { email: "artist@example.com", displayName: "Artist Name" },
      ],
      visibility: "private",
      transparency: "opaque",
    });
    expect(event.body).not.toHaveProperty("location");
    expect(event.body).not.toHaveProperty("conferenceData");
    expect(event.body).not.toHaveProperty("organizer");
  });

  it("keeps approved attendee response statuses while normalizing reconciliation writes", () => {
    const event = buildGoogleCalendarEventWrite({
      ...BASE,
      kind: "confirmed",
      attendeeMode: "set_participants",
      summary: "Vocal production",
      participants: [
        {
          email: " Producer@Example.com ",
          displayName: " Producer Name ",
          responseStatus: "accepted",
        },
        {
          email: " Artist@Example.com ",
          displayName: " Artist Name ",
          responseStatus: "declined",
        },
      ],
      artistSafeSessionUrl: "https://skitza.app/artist/sessions/session_123",
    });

    expect(event.body.attendees).toEqual([
      {
        email: "producer@example.com",
        displayName: "Producer Name",
        responseStatus: "accepted",
      },
      {
        email: "artist@example.com",
        displayName: "Artist Name",
        responseStatus: "declined",
      },
    ]);
  });

  it("omits attendee arrays from later edits so Google-only guests survive", () => {
    const event = buildGoogleCalendarEventWrite({
      ...BASE,
      kind: "confirmed",
      attendeeMode: "preserve",
      summary: "Moved session",
      artistSafeSessionUrl: "https://skitza.app/artist/sessions/session_123",
    });

    expect(event.attendeeMode).toBe("preserve");
    expect(event.body).not.toHaveProperty("attendees");
  });

  it("rejects unsafe URLs, identifiers, intervals, and revisions", () => {
    for (const event of [
      { ...BASE, kind: "hold" as const, eventId: "booking-raw-id" },
      { ...BASE, kind: "hold" as const, opaqueLink: "raw booking id" },
      { ...BASE, kind: "hold" as const, revision: 0 },
      { ...BASE, kind: "hold" as const, endsAt: BASE.startsAt },
      {
        ...BASE,
        kind: "confirmed" as const,
        attendeeMode: "set_participants" as const,
        summary: "Session",
        participants: [{ email: "artist@example.com" }] as const,
        artistSafeSessionUrl: "https://evil.example/session",
      },
    ]) {
      expect(() => buildGoogleCalendarEventWrite(event)).toThrow(
        GoogleCalendarEventValidationError,
      );
    }
  });
});
