import { createHmac } from "node:crypto";

const GOOGLE_EVENT_ID_PATTERN = /^[0-9a-v]{5,1024}$/u;
const OPAQUE_LINK_PATTERN = /^[A-Za-z0-9_-]{16,128}$/u;
const MAX_SUMMARY_LENGTH = 1_024;
const MAX_DISPLAY_NAME_LENGTH = 256;
const MAX_URL_LENGTH = 2_048;

export type GoogleCalendarApprovedEventInput = Readonly<{
  eventId: string;
  startsAt: Date;
  endsAt: Date;
  revision: number;
  opaqueLink: string;
}> &
  (
    | Readonly<{ kind: "hold" }>
    | (Readonly<{
        kind: "confirmed";
        summary: string;
        artistSafeSessionUrl?: string;
      }> &
        (
          | Readonly<{
              attendeeMode: "set_artist";
              artist: Readonly<{ email: string; displayName?: string }>;
            }>
          | Readonly<{ attendeeMode: "preserve" }>
        ))
  );

export type GoogleCalendarEventBody = Readonly<{
  summary: string;
  description?: string;
  start: Readonly<{ dateTime: string; timeZone: "UTC" }>;
  end: Readonly<{ dateTime: string; timeZone: "UTC" }>;
  visibility: "private";
  transparency: "opaque";
  attendees?: readonly Readonly<{ email: string; displayName?: string }>[];
  extendedProperties: Readonly<{
    private: Readonly<{
      skitzaLink: string;
      skitzaRevision: string;
      skitzaSchema: "1";
    }>;
  }>;
  guestsCanInviteOthers: false;
  guestsCanModify: false;
  guestsCanSeeOtherGuests: false;
  reminders: Readonly<{ useDefault: false }>;
}>;

export type GoogleCalendarEventWrite = Readonly<{
  eventId: string;
  kind: "hold" | "confirmed";
  attendeeMode: "clear" | "set_artist" | "preserve";
  body: GoogleCalendarEventBody;
}>;

export class GoogleCalendarEventValidationError extends Error {
  constructor() {
    super("Invalid Google Calendar event intent");
    this.name = "GoogleCalendarEventValidationError";
  }
}

function fail(): never {
  throw new GoogleCalendarEventValidationError();
}

function normalizedRequiredText(value: string, maxLength: number): string {
  const normalized = value.trim();
  const hasControlCharacter = Array.from(normalized).some((character) => {
    const code = character.charCodeAt(0);
    return code <= 31 || code === 127;
  });
  if (!normalized || normalized.length > maxLength || hasControlCharacter) {
    return fail();
  }
  return normalized;
}

function normalizedEmail(value: string): string {
  const email = value.trim().toLowerCase();
  if (
    !email ||
    email.length > 320 ||
    /\s/u.test(email) ||
    email.indexOf("@") < 1 ||
    email.endsWith("@")
  ) {
    return fail();
  }
  return email;
}

function normalizedArtistSafeUrl(value: string): string {
  if (value !== value.trim() || value.length < 1 || value.length > MAX_URL_LENGTH) return fail();
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return fail();
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.hash ||
    !url.hostname ||
    url.hostname !== "skitza.app"
  ) {
    return fail();
  }
  return url.toString();
}

export function isValidGoogleCalendarEventId(value: string): boolean {
  return GOOGLE_EVENT_ID_PATTERN.test(value);
}

/**
 * Google accepts client-supplied base32hex event IDs. The digest is opaque,
 * stable across retries for one link, and changes when an account switch
 * creates a new link. The digest cannot reveal the link key it came from.
 */
export function deriveGoogleCalendarEventId(
  input: Readonly<{
    producerId: string;
    linkKey: string;
    secret: Uint8Array;
  }>,
): string {
  const producerId = normalizedRequiredText(input.producerId, 255);
  const linkKey = normalizedRequiredText(input.linkKey, 255);
  if (input.secret.byteLength < 32) return fail();
  return `sk${createHmac("sha256", input.secret)
    .update("google-calendar-event\0", "utf8")
    .update(producerId, "utf8")
    .update("\0", "utf8")
    .update(linkKey, "utf8")
    .digest("hex")}`;
}

export function buildGoogleCalendarEventWrite(
  input: GoogleCalendarApprovedEventInput,
): GoogleCalendarEventWrite {
  if (!isValidGoogleCalendarEventId(input.eventId)) return fail();
  if (!Number.isSafeInteger(input.revision) || input.revision < 1) return fail();
  if (!OPAQUE_LINK_PATTERN.test(input.opaqueLink)) return fail();

  const startsAt = input.startsAt.getTime();
  const endsAt = input.endsAt.getTime();
  if (!Number.isFinite(startsAt) || !Number.isFinite(endsAt) || startsAt >= endsAt) return fail();

  const common = {
    start: { dateTime: input.startsAt.toISOString(), timeZone: "UTC" as const },
    end: { dateTime: input.endsAt.toISOString(), timeZone: "UTC" as const },
    visibility: "private" as const,
    transparency: "opaque" as const,
    extendedProperties: {
      private: {
        skitzaLink: input.opaqueLink,
        skitzaRevision: String(input.revision),
        skitzaSchema: "1" as const,
      },
    },
    guestsCanInviteOthers: false as const,
    guestsCanModify: false as const,
    guestsCanSeeOtherGuests: false as const,
    reminders: { useDefault: false as const },
  };

  if (input.kind === "hold") {
    return {
      eventId: input.eventId,
      kind: "hold",
      attendeeMode: "clear",
      body: {
        ...common,
        summary: "Reserved",
        attendees: [],
      },
    };
  }

  const description =
    input.artistSafeSessionUrl === undefined
      ? undefined
      : normalizedArtistSafeUrl(input.artistSafeSessionUrl);

  return {
    eventId: input.eventId,
    kind: "confirmed",
    attendeeMode: input.attendeeMode,
    body: {
      ...common,
      summary: normalizedRequiredText(input.summary, MAX_SUMMARY_LENGTH),
      ...(description ? { description } : {}),
      ...(input.attendeeMode === "set_artist"
        ? {
            attendees: [
              {
                email: normalizedEmail(input.artist.email),
                ...(input.artist.displayName === undefined
                  ? {}
                  : {
                      displayName: normalizedRequiredText(
                        input.artist.displayName,
                        MAX_DISPLAY_NAME_LENGTH,
                      ),
                    }),
              },
            ],
          }
        : {}),
    },
  };
}
