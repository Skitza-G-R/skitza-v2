// KPI strip for the Today dashboard. Pure projection — a server
// component that formats the numbers and renders 4 small tiles.
// Tone swaps to warn when there are unresolved items, drawing the
// producer's eye to the one action-demanding metric on the strip.

type Props = {
  kpis: {
    activeProjects: number;
    revenueMonthCents: number;
    revenueCurrency: string;
    upcomingSessions7d: number;
    unresolvedItems: number;
  };
};

export function KpiStrip({ kpis }: Props) {
  // cents → major-units via Intl. 0 fraction digits is deliberate —
  // the strip is a glance, not an invoice. Fallback to USD when the
  // producer hasn't set a default (shouldn't happen post-onboarding).
  const format = (cents: number) =>
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: kpis.revenueCurrency || "USD",
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(cents / 100);

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <Kpi label="Active projects" value={String(kpis.activeProjects)} />
      <Kpi label="Revenue · month" value={format(kpis.revenueMonthCents)} />
      <Kpi label="Sessions · 7d" value={String(kpis.upcomingSessions7d)} />
      <Kpi
        label="Unresolved"
        value={String(kpis.unresolvedItems)}
        tone={kpis.unresolvedItems > 0 ? "warn" : "default"}
      />
    </div>
  );
}

function Kpi({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "default" | "warn";
}) {
  return (
    <div className="rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-4">
      <p className="font-mono text-[0.62rem] uppercase tracking-wider text-[rgb(var(--fg-muted))]">
        {label}
      </p>
      <p
        className={`mt-1 font-display text-2xl tracking-tight ${
          tone === "warn" ? "text-[rgb(var(--fg-warning))]" : ""
        }`}
      >
        {value}
      </p>
    </div>
  );
}
