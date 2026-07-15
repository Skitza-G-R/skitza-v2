const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const MONTHS_SHORT = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

export type CalendarDateTimeParts = {
  year: number;
  month: number;
  day: number;
  weekday: (typeof WEEKDAYS)[number];
  hour: number;
  minute: number;
};

export function normalizeCalendarTimeZone(
  timeZone: string | null | undefined,
): string {
  const candidate = timeZone?.trim() || "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: candidate }).format(0);
    return candidate;
  } catch {
    return "UTC";
  }
}

export function calendarDateTimeParts(
  date: Date,
  timeZone: string,
): CalendarDateTimeParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: normalizeCalendarTimeZone(timeZone),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));

  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    weekday: WEEKDAYS.includes(values.weekday as CalendarDateTimeParts["weekday"])
      ? (values.weekday as CalendarDateTimeParts["weekday"])
      : "Sun",
    hour: Number(values.hour),
    minute: Number(values.minute),
  };
}

export function formatCalendarTime(date: Date, timeZone: string): string {
  const { hour, minute } = calendarDateTimeParts(date, timeZone);
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

export function formatCalendarDate(date: Date, timeZone: string): string {
  const { weekday, month, day } = calendarDateTimeParts(date, timeZone);
  return `${weekday}, ${MONTHS_SHORT[month - 1] ?? MONTHS_SHORT[0]} ${String(day)}`;
}
