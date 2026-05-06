import type { ReactNode } from "react";

// Server component — Hero block at the top of /artist. Mirrors the
// locked design's "Yael." display heading + status meta. We don't
// hold a real user record yet for first-name display; we accept it
// as a prop so the page-level Server Component can pull it from
// Clerk (or fall back to a friendly default).
//
// Status-line composition is intentionally simple: each upstream
// signal contributes a short bit ("1 mix to review", "session this
// week"); HomeHero just joins them with " · ". Page passes the
// pre-formatted line to keep this component free of business logic.
export function HomeHero({
  firstName,
  todayLabel,
  statusLine,
}: {
  firstName: string;
  todayLabel: string;
  statusLine: string;
}): ReactNode {
  return (
    <header className="reveal-up px-1 pb-2 pt-1 sm:px-0">
      <p className="font-mono text-[0.66rem] font-semibold uppercase tracking-wider text-[rgb(var(--fg-muted))]">
        {todayLabel}
      </p>
      <h1 className="mt-1 font-display text-[34px] font-extrabold leading-none tracking-[-0.035em] text-[rgb(var(--fg-default))]">
        {firstName}
        <span style={{ color: "rgb(var(--brand-primary))" }}>.</span>
      </h1>
      <p className="mt-2.5 text-[13.5px] leading-snug text-[rgb(var(--fg-muted))]">
        {statusLine}
      </p>
    </header>
  );
}
