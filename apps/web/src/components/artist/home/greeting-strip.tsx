// Greeting strip at the very top of the artist home page. Date
// eyebrow + "Good afternoon, {firstName}." — no search, no CTA.
// Server component; the date is computed at request time.

type Props = {
  firstName: string;
  now?: Date;
};

export function GreetingStrip({ firstName, now }: Props) {
  const date = now ?? new Date();
  const dateLabel = date
    .toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
    })
    .toUpperCase()
    .replace(/,/g, " ·");
  const greeting = greetingForHour(date.getHours(), firstName);
  return (
    <header className="pb-4">
      <p
        className="uppercase text-[10.5px] font-semibold tracking-[0.12em] text-[var(--fg-muted)]"
        style={{ fontFamily: "var(--font-jetbrains-mono)" }}
      >
        {dateLabel}
      </p>
      <h1
        className="mt-1 text-[18px] font-extrabold text-[var(--fg-default)]"
        style={{ fontFamily: "var(--font-syne)", letterSpacing: "-0.03em" }}
      >
        {greeting}
      </h1>
    </header>
  );
}

// Time-of-day greeting. Exported for direct unit testing.
export function greetingForHour(hour: number, firstName: string): string {
  if (hour < 5) return `Working late, ${firstName}.`;
  if (hour < 12) return `Good morning, ${firstName}.`;
  if (hour < 18) return `Good afternoon, ${firstName}.`;
  return `Good evening, ${firstName}.`;
}
