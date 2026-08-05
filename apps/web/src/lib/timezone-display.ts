function gmtOffsetLabel(instant: Date, timeZone: string): string {
  const label = new Intl.DateTimeFormat("en", {
    timeZone,
    timeZoneName: "shortOffset",
  })
    .formatToParts(instant)
    .find((part) => part.type === "timeZoneName")?.value;

  const gmtLabel = label?.replace(/^UTC/, "GMT") ?? "GMT";
  return /^GMT(?:[+-]0{1,2}(?::?00)?)?$/.test(gmtLabel) ? "GMT" : gmtLabel;
}

export function formatGmtClockTime(
  instant: Date,
  timeZone: string,
  locales?: string | string[],
): string {
  const time = new Intl.DateTimeFormat(locales, {
    hour: "numeric",
    minute: "2-digit",
    timeZone,
  }).format(instant);

  return `${time} ${gmtOffsetLabel(instant, timeZone)}`;
}

export function formatResolvedTimeZoneLabel(
  timeZone: string,
  instant = new Date(),
): string {
  return `${timeZone} · ${gmtOffsetLabel(instant, timeZone)}`;
}

export function formatTimeZoneSettingLabel(timeZone: string): string {
  return timeZone === "UTC" ? "GMT" : timeZone.replaceAll("_", " ");
}
