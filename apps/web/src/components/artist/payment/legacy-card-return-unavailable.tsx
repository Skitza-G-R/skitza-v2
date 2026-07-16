import Link from "next/link";

type LegacyCardReturnUnavailableProps = {
  title: string;
  explanation: string;
  nextStep: string;
  safetyNotice: string;
};

export function LegacyCardReturnUnavailable({
  title,
  explanation,
  nextStep,
  safetyNotice,
}: LegacyCardReturnUnavailableProps) {
  return (
    <div className="mx-auto flex w-full max-w-md justify-center py-4 lg:py-10">
      <section
        aria-labelledby="card-return-unavailable-title"
        className="w-full rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-6 shadow-[var(--shadow-sm)] sm:p-8"
      >
        <p className="font-mono text-[10px] font-bold tracking-[0.16em] text-[rgb(var(--brand-primary))] uppercase">
          Payment information
        </p>
        <h1
          id="card-return-unavailable-title"
          className="font-syne mt-3 text-2xl font-bold text-[rgb(var(--fg-default))]"
        >
          {title}
        </h1>
        <p className="mt-3 text-sm leading-6 text-[rgb(var(--fg-muted))]">{explanation}</p>
        <p className="mt-3 text-sm leading-6 text-[rgb(var(--fg-muted))]">{nextStep}</p>

        <p
          role="note"
          className="mt-5 rounded-[var(--radius-lg)] bg-[rgb(var(--bg-background))] px-4 py-3 text-sm font-medium text-[rgb(var(--fg-default))]"
        >
          {safetyNotice}
        </p>

        <Link
          href="/artist"
          className="mt-6 flex min-h-11 w-full items-center justify-center rounded-[var(--radius-lg)] bg-[rgb(var(--bg-sidebar))] px-5 py-3 text-sm font-bold text-[rgb(var(--brand-primary))] transition-[filter,transform] hover:brightness-110 active:scale-[0.98]"
        >
          Back to dashboard
        </Link>
      </section>
    </div>
  );
}
