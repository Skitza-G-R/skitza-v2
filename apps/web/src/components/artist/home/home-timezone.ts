function zonedParts(value: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(value);
  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

export function artistGreeting(now: Date, firstName: string, timeZone: string): string {
  const hour = Number(zonedParts(now, timeZone).hour);
  if (hour < 12) return `Good morning, ${firstName}.`;
  if (hour < 18) return `Good afternoon, ${firstName}.`;
  return `Good evening, ${firstName}.`;
}

export function isSameArtistDay(left: Date, right: Date, timeZone: string): boolean {
  const leftParts = zonedParts(left, timeZone);
  const rightParts = zonedParts(right, timeZone);
  return (
    leftParts.year === rightParts.year &&
    leftParts.month === rightParts.month &&
    leftParts.day === rightParts.day
  );
}

export function formatArtistTimeRange(start: Date, durationMin: number, timeZone: string): string {
  const end = new Date(start.getTime() + durationMin * 60_000);
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  return `${formatter.format(start)}–${formatter.format(end)}`;
}

export function formatArtistDateTime(value: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(value);
}
