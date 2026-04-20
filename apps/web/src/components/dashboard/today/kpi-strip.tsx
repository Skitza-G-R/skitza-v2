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
    // Batch C — KPIs float on the gradient instead of sitting in
    // bordered cards. A thin divider rule between columns keeps them
    // legible on desktop; mobile drops the divider (2-col grid would
    // land a stray line in the middle). Metric values get the display
    // font at 3xl/4xl — editorial, not utility.
    <div className="grid grid-cols-2 gap-x-6 gap-y-6 sm:grid-cols-4 sm:divide-x sm:divide-[rgb(var(--border-subtle))]">
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
    // Column-level padding-left handles the divider inset on desktop;
    // first column has no leading padding so the eyebrow aligns with
    // the page gutter. No border/background — typography carries it.
    <div className="sm:px-5 sm:first:pl-0">
      <p className="font-mono text-[0.66rem] uppercase tracking-[0.16em] text-[rgb(var(--fg-muted))]">
        {label}
      </p>
      <p
        className={`mt-2 font-display text-3xl tracking-tight sm:text-4xl ${
          tone === "warn" ? "text-[rgb(var(--fg-warning))]" : "text-[rgb(var(--fg-primary))]"
        }`}
      >
        {value}
      </p>
    </div>
  );
}
