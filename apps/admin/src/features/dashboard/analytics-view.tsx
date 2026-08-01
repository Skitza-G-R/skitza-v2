"use client";

import { useMemo, useState } from "react";

import type { DemoAnalytics, DemoChartPoint } from "~/lib/admin-demo-view-models";
import { useDashboardFeedback } from "./dashboard-interactions";
import styles from "./dashboard.module.css";
import { buildAnalyticsCsv } from "./operations-demo";
import { BarChart, MetricLedger, PageHeader, Panel } from "./shared";

type AnalyticsInterval = "day" | "month" | "week";
type AnalyticsRange = "4" | "12" | "26";

const RANGE_LABELS: Record<AnalyticsRange, string> = {
  "4": "Last 4 weeks",
  "12": "Last 12 weeks",
  "26": "Last 26 weeks",
};

const INTERVAL_LABELS: Record<AnalyticsInterval, string> = {
  day: "Daily",
  week: "Weekly",
  month: "Monthly",
};

function takeLatest(points: readonly DemoChartPoint[], count: number): readonly DemoChartPoint[] {
  return points.slice(Math.max(0, points.length - count));
}

function samplePoints(
  points: readonly DemoChartPoint[],
  interval: AnalyticsInterval,
): readonly DemoChartPoint[] {
  if (interval === "day" || points.length <= 2) return points;

  const stride = interval === "week" ? 2 : 4;
  return points.filter(
    (_point, index) => index === points.length - 1 || index % stride === 0,
  );
}

function withoutComparison(points: readonly DemoChartPoint[]): readonly DemoChartPoint[] {
  return points.map((point) => ({
    label: point.label,
    value: point.value,
  }));
}

export function AnalyticsView({ data }: { data: DemoAnalytics }) {
  const { showFeedback } = useDashboardFeedback();
  const [range, setRange] = useState<AnalyticsRange>("12");
  const [interval, setInterval] = useState<AnalyticsInterval>("week");
  const [compare, setCompare] = useState(true);

  const visibleData = useMemo(() => {
    const requestedRange = Number(range);
    const activationCohorts = takeLatest(data.activationCohorts, requestedRange);
    const weeklyActive = samplePoints(
      takeLatest(data.weeklyActive, requestedRange),
      interval,
    );
    const retention = takeLatest(data.retention, requestedRange);

    return {
      ...data,
      activationCohorts: compare ? activationCohorts : withoutComparison(activationCohorts),
      weeklyActive,
      retention,
    } satisfies DemoAnalytics;
  }, [compare, data, interval, range]);

  const visiblePointCount =
    visibleData.activationCohorts.length +
    visibleData.weeklyActive.length +
    visibleData.retention.length +
    visibleData.salesByCurrency.length;

  const resetControls = () => {
    setRange("12");
    setInterval("week");
    setCompare(true);
    showFeedback("Analytics controls reset");
  };

  const exportCsv = () => {
    try {
      const selection = [
        `selected_range,${range}_weeks`,
        `selected_interval,${interval}`,
        `comparison,${compare ? "on" : "off"}`,
        "",
      ].join("\n");
      const csv = `${selection}${buildAnalyticsCsv(visibleData)}`;
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");

      link.href = url;
      link.download = `skitza-${data.environment}-analytics-${range}w-${interval}.csv`;
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => {
        URL.revokeObjectURL(url);
      }, 0);

      showFeedback("Analytics CSV downloaded");
    } catch {
      showFeedback("CSV download failed. Try again.", "danger");
    }
  };

  return (
    <div className={styles.page}>
      <PageHeader
        eyebrow="Trustworthy product signals"
        title="Analytics."
        description="Activation, meaningful work, retention, and recorded sales—defined clearly and kept separate from vanity page views."
        updatedAt={data.updatedAt}
      />

      <div className={styles.toolbar}>
        <div className={styles.filters} aria-label="Analytics controls">
          <select
            aria-label="Analytics range"
            className={styles.filter}
            onChange={(event) => {
              setRange(event.target.value as AnalyticsRange);
            }}
            value={range}
          >
            <option value="4">Last 4 weeks</option>
            <option value="12">Last 12 weeks</option>
            <option value="26">Last 26 weeks</option>
          </select>
          <select
            aria-label="Chart interval"
            className={styles.filter}
            onChange={(event) => {
              setInterval(event.target.value as AnalyticsInterval);
            }}
            value={interval}
          >
            <option value="day">Daily interval</option>
            <option value="week">Weekly interval</option>
            <option value="month">Monthly interval</option>
          </select>
          <button
            aria-pressed={compare}
            className={styles.filter}
            data-active={compare ? "true" : "false"}
            onClick={() => {
              setCompare((current) => !current);
            }}
            type="button"
          >
            Compare provisional
          </button>
          <button className={styles.filter} onClick={resetControls} type="button">
            Reset
          </button>
        </div>
        <button className={styles.secondaryAction} onClick={exportCsv} type="button">
          Export demo CSV
        </button>
      </div>

      <p className={styles.definition} aria-live="polite">
        {visiblePointCount.toLocaleString("en-US")} chart samples · {RANGE_LABELS[range]} ·{" "}
        {INTERVAL_LABELS[interval]} interval · comparison {compare ? "on" : "off"}
      </p>

      <MetricLedger label="Primary analytics metrics" metrics={data.metrics} />

      <div className={styles.dashboardGrid}>
        <Panel
          title="Activation cohorts"
          meta={`${RANGE_LABELS[range]} · ${compare ? "current + provisional" : "current only"}`}
        >
          <BarChart
            label="Mature producer activation versus provisional cohorts"
            maximum={55}
            points={visibleData.activationCohorts}
            {...(compare ? { secondaryLabel: "provisional" } : {})}
          />
        </Panel>
        <Panel title="Four-week retention" meta={`${RANGE_LABELS[range]} · activated producers`}>
          <BarChart
            label="Activated producers returning to meaningful work four weeks later"
            maximum={60}
            points={visibleData.retention}
          />
        </Panel>
      </div>

      <div className={styles.dashboardGrid}>
        <Panel
          title="Weekly active producers"
          meta={`${INTERVAL_LABELS[interval]} sample · meaningful work`}
        >
          <BarChart
            label="Unique producers doing meaningful work in the trailing seven days"
            maximum={100}
            points={visibleData.weeklyActive}
          />
        </Panel>
        <Panel title="Verified sales recorded" meta="Currencies never combined">
          <BarChart
            label="Recorded sales shown separately by source currency"
            points={visibleData.salesByCurrency}
          />
        </Panel>
      </div>

      <p className={styles.paymentNote}>
        Metric definitions stay fixed across cards, charts, and exports. Subscription revenue
        remains unavailable until real subscription billing is connected. Demo range and interval
        controls only sample the records bundled with this preview.
      </p>
    </div>
  );
}
