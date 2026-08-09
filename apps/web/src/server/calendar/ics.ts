import type { CalendarSyncJobPayloadSnapshot } from "@skitza/db";

export type SessionCalendarPayload = CalendarSyncJobPayloadSnapshot;

const encoder = new TextEncoder();
const MAX_CONTENT_LINE_OCTETS = 75;

function assertText(value: string, label: string, allowEmpty = false): void {
  let hasUnsupportedControl = false;
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (
      codePoint !== undefined &&
      ((codePoint < 0x20 && character !== "\t" && character !== "\r" && character !== "\n") ||
        codePoint === 0x7f)
    ) {
      hasUnsupportedControl = true;
      break;
    }
  }
  if ((!allowEmpty && value.trim().length === 0) || hasUnsupportedControl) {
    throw new Error(`Invalid calendar ${label}`);
  }
}

function assertEmail(value: string, label: string): void {
  let hasControlOrWhitespace = false;
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint !== undefined && (codePoint <= 0x20 || codePoint === 0x7f)) {
      hasControlOrWhitespace = true;
      break;
    }
  }
  if (
    value.length > 254 ||
    hasControlOrWhitespace ||
    /[,;:<>"\\]/u.test(value) ||
    !/^[^@]+@[^@]+$/u.test(value)
  ) {
    throw new Error(`Invalid calendar ${label}`);
  }
}

function utcDateProperty(value: string, label: string): { date: Date; propertyValue: string } {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(value)) {
    throw new Error(`Invalid calendar ${label}`);
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid calendar ${label}`);
  const secondsOnly = value.replace(/\.\d{3}Z$/u, "Z");
  if (date.toISOString().replace(/\.\d{3}Z$/u, "Z") !== secondsOnly) {
    throw new Error(`Invalid calendar ${label}`);
  }
  return {
    date,
    propertyValue: date
      .toISOString()
      .replace(/[-:]/gu, "")
      .replace(/\.\d{3}Z$/u, "Z"),
  };
}

export function escapeCalendarText(value: string): string {
  return value
    .replace(/\\/gu, "\\\\")
    .replace(/\r\n|\r|\n/gu, "\\n")
    .replace(/;/gu, "\\;")
    .replace(/,/gu, "\\,");
}

function escapeParameterValue(value: string): string {
  return value
    .replace(/\^/gu, "^^")
    .replace(/\r\n|\r|\n/gu, "^n")
    .replace(/"/gu, "^'");
}

export function foldCalendarContentLine(line: string): string {
  if (encoder.encode(line).byteLength <= MAX_CONTENT_LINE_OCTETS) return line;

  const chunks: string[] = [];
  let chunk = "";
  let chunkBytes = 0;
  let capacity = MAX_CONTENT_LINE_OCTETS;

  for (const character of line) {
    const characterBytes = encoder.encode(character).byteLength;
    if (chunk.length > 0 && chunkBytes + characterBytes > capacity) {
      chunks.push(chunk);
      chunk = "";
      chunkBytes = 0;
      // The whitespace prefix on a folded continuation consumes one octet.
      capacity = MAX_CONTENT_LINE_OCTETS - 1;
    }
    chunk += character;
    chunkBytes += characterBytes;
  }
  if (chunk.length > 0) chunks.push(chunk);

  return chunks.join("\r\n ");
}

export function buildSessionCalendarIcs(payload: SessionCalendarPayload): string {
  const runtimePayload = payload as unknown as Readonly<{
    schemaVersion?: unknown;
    method?: unknown;
  }>;
  if (runtimePayload.schemaVersion !== 1) {
    throw new Error("Unsupported calendar payload version");
  }
  if (runtimePayload.method !== "REQUEST" && runtimePayload.method !== "CANCEL") {
    throw new Error("Invalid calendar method");
  }
  if (!Number.isSafeInteger(payload.sequence) || payload.sequence < 0) {
    throw new Error("Invalid calendar sequence");
  }

  assertText(payload.uid, "UID");
  assertText(payload.summary, "summary");
  assertText(payload.description, "description", true);
  assertText(payload.organizer.name, "organizer name");
  assertText(payload.attendee.name, "attendee name");
  assertEmail(payload.organizer.email, "organizer email");
  assertEmail(payload.attendee.email, "attendee email");

  const dtstamp = utcDateProperty(payload.dtstampUtc, "DTSTAMP");
  const startsAt = utcDateProperty(payload.startsAtUtc, "DTSTART");
  const endsAt = utcDateProperty(payload.endsAtUtc, "DTEND");
  if (endsAt.date.getTime() <= startsAt.date.getTime()) {
    throw new Error("Calendar DTEND must be after DTSTART");
  }

  const attendee =
    payload.method === "REQUEST"
      ? `ATTENDEE;CN="${escapeParameterValue(payload.attendee.name)}";ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:${payload.attendee.email}`
      : `ATTENDEE;CN="${escapeParameterValue(payload.attendee.name)}";ROLE=REQ-PARTICIPANT:mailto:${payload.attendee.email}`;
  const lines = [
    "BEGIN:VCALENDAR",
    "PRODID:-//Skitza//Session Calendar//EN",
    "VERSION:2.0",
    "CALSCALE:GREGORIAN",
    `METHOD:${payload.method}`,
    "BEGIN:VEVENT",
    `UID:${escapeCalendarText(payload.uid)}`,
    `DTSTAMP:${dtstamp.propertyValue}`,
    `DTSTART:${startsAt.propertyValue}`,
    `DTEND:${endsAt.propertyValue}`,
    `SEQUENCE:${String(payload.sequence)}`,
    `STATUS:${payload.method === "REQUEST" ? "CONFIRMED" : "CANCELLED"}`,
    `SUMMARY:${escapeCalendarText(payload.summary)}`,
    `DESCRIPTION:${escapeCalendarText(payload.description)}`,
    `ORGANIZER;CN="${escapeParameterValue(payload.organizer.name)}":mailto:${payload.organizer.email}`,
    attendee,
    "END:VEVENT",
    "END:VCALENDAR",
  ];

  return `${lines.map(foldCalendarContentLine).join("\r\n")}\r\n`;
}
