const FALLBACK_TIMEZONE = "UTC";

function safeTimeZone(timezone: string): string {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone });
    return timezone;
  } catch {
    return FALLBACK_TIMEZONE;
  }
}

/** Stable calendar-day key in the producer's configured timezone. */
export function dateKeyInTimeZone(date: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: safeTimeZone(timezone),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const value = (type: "year" | "month" | "day") =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

export function greetingFor(
  date: Date,
  timezone: string,
): "Good morning" | "Good afternoon" | "Good evening" {
  const hourPart = new Intl.DateTimeFormat("en-US", {
    timeZone: safeTimeZone(timezone),
    hour: "2-digit",
    hourCycle: "h23",
  })
    .formatToParts(date)
    .find((part) => part.type === "hour")?.value;
  const hour = Number(hourPart ?? "0");
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

export function formatDashboardTime(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: safeTimeZone(timezone),
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

export function formatDashboardDate(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: safeTimeZone(timezone),
    month: "short",
    day: "numeric",
  }).format(date);
}
