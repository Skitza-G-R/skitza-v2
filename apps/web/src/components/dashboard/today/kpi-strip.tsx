"use client";

// KPI strip for the Today dashboard. Pure projection — formats the
// numbers and renders 4 small tiles. Tone swaps to warn when there
// are unresolved items, drawing the producer's eye to the one
// action-demanding metric on the strip.
//
// Client component (invoked from the client-side TodayView) so it uses
// the `useTranslations` hook rather than `getTranslations`. The messages
// are already hydrated in the NextIntlClientProvider mounted at the
// root layout; calling the hook here is zero-cost.

import { useTranslations } from "next-intl";

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
  const t = useTranslations("today.kpi");
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
    // KPIs float on the gradient instead of sitting in bordered cards.
    // The desktop layout drops the horizontal `gap-x` so divider rules
    // hug their column edges (gap+divide together left the divider
    // floating in space, detached from either neighbour). Mobile keeps
    // a 2-col grid with a comfortable `gap-y` and no divider — a
    // vertical hairline mid-grid would just land between two unrelated
    // pairs of cells. Metric values use the display font at 3xl/4xl.
    <div className="grid grid-cols-2 gap-y-6 sm:grid-cols-4 sm:gap-x-0 sm:divide-x sm:divide-[rgb(var(--border-subtle))]">
      <Kpi label={t("activeProjects")} value={String(kpis.activeProjects)} />
      <Kpi label={t("revenueMonth")} value={format(kpis.revenueMonthCents)} />
      <Kpi label={t("sessions7d")} value={String(kpis.upcomingSessions7d)} />
      <Kpi
        label={t("unresolved")}
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
    // `flex flex-col justify-end` anchors the value to the bottom of
    // the cell so all four numbers sit on the same baseline regardless
    // of label-wrap differences (e.g. when one column's label needs
    // two lines and the others fit on one). Column-level `sm:px-5` +
    // `sm:first:ps-0` insets the divider so it lives in negative space
    // between the cells without crowding the text.
    <div className="flex flex-col justify-end sm:px-5 sm:first:ps-0">
      <p className="font-mono text-[0.66rem] uppercase tracking-[0.16em] text-[rgb(var(--fg-muted))]">
        {label}
      </p>
      <p
        className={`sk-num mt-2 font-display text-3xl leading-none tracking-tight sm:text-4xl ${
          tone === "warn" ? "text-[rgb(var(--fg-warning))]" : "text-[rgb(var(--fg-primary))]"
        }`}
      >
        {value}
      </p>
    </div>
  );
}
