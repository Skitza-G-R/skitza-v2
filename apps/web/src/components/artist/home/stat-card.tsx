// Desktop stat tile — used in the 4-up row at the top of the artist
// desktop home. Each tile: small label eyebrow + big Syne value +
// optional sub-line. `accent` swaps the value to the copper accent
// for figures that benefit from contrast (e.g. balance-due).

export function StatCard({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: "default" | "copper";
}) {
  const valueClass =
    accent === "copper"
      ? "text-[rgb(var(--brand-copper))]"
      : "text-[rgb(var(--fg-default))]";
  return (
    <div className="rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-5 py-4 shadow-[var(--shadow-sm)]">
      <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-[rgb(var(--fg-muted))]">
        {label}
      </p>
      <p
        className={`mt-1 font-display text-[30px] font-extrabold leading-none tracking-tight ${valueClass}`}
      >
        {value}
      </p>
      {sub ? (
        <p className="mt-1.5 text-xs text-[rgb(var(--fg-muted))]">{sub}</p>
      ) : null}
    </div>
  );
}
