import type { ReactNode } from "react";

// Server component — first-name hero + one status sentence.
//
// Replaces the prior multi-bit subline ("new mix · session this week ·
// balance pending") with a single curated sentence picked by the
// caller based on the focal item ("Your new mix is ready.", "One
// payment due.", "All quiet."). Carries less cognitive load and
// matches the inbox model: the page tells you ONE thing.
export function InboxHero({
  firstName,
  todayLabel,
  subline,
}: {
  firstName: string;
  todayLabel: string;
  subline: string;
}): ReactNode {
  return (
    <header className="reveal-up">
      <p className="font-mono text-[0.66rem] font-medium uppercase tracking-[0.16em] text-[rgb(var(--fg-muted))]">
        {todayLabel}
      </p>
      <h1 className="mt-2 font-display text-[42px] font-extrabold leading-[0.9] tracking-[-0.035em] text-[rgb(var(--fg-default))] lg:text-[56px]">
        {firstName}
        <span style={{ color: "rgb(var(--brand-primary))" }}>.</span>
      </h1>
      <p className="mt-4 text-[15px] leading-snug text-[rgb(var(--fg-secondary))] lg:text-[16px]">
        {subline}
      </p>
    </header>
  );
}
