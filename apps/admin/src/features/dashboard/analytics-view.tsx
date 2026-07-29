import type { DemoAnalytics } from "~/lib/admin-demo-view-models";
import styles from "./dashboard.module.css";
import { BarChart, MetricLedger, PageHeader, Panel } from "./shared";

export function AnalyticsView({ data }: { data: DemoAnalytics }) {
  return (
    <div className={styles.page}>
      <PageHeader
        eyebrow="Trustworthy product signals"
        title="Analytics."
        description="Activation, meaningful work, retention, and recorded sales—defined clearly and kept separate from vanity page views."
        updatedAt={data.updatedAt}
      />

      <div className={styles.toolbar}>
        <div className={styles.filters} aria-label="Example analytics ranges">
          <span className={styles.filter} data-active="true">
            Last 12 weeks
          </span>
          <span className={styles.filter}>Mature cohorts</span>
          <span className={styles.filter}>All producer types</span>
        </div>
        <button className={styles.disabledButton} disabled type="button">
          Export CSV · unavailable in demo
        </button>
      </div>

      <MetricLedger label="Primary analytics metrics" metrics={data.metrics} />

      <div className={styles.dashboardGrid}>
        <Panel title="Activation cohorts" meta="First qualifying event in 14 days">
          <BarChart
            label="Mature producer activation versus provisional cohorts"
            maximum={55}
            points={data.activationCohorts}
            secondaryLabel="provisional"
          />
        </Panel>
        <Panel title="Four-week retention" meta="Activated producers only">
          <BarChart
            label="Activated producers returning to meaningful work four weeks later"
            maximum={60}
            points={data.retention}
          />
        </Panel>
      </div>

      <div className={styles.dashboardGrid}>
        <Panel title="Weekly active producers" meta="Meaningful work · not visits">
          <BarChart
            label="Unique producers doing meaningful work in the trailing seven days"
            maximum={100}
            points={data.weeklyActive}
          />
        </Panel>
        <Panel title="Verified sales recorded" meta="Currencies never combined">
          <BarChart
            label="Recorded sales shown separately by source currency"
            points={data.salesByCurrency}
          />
        </Panel>
      </div>

      <p className={styles.paymentNote}>
        Metric definitions stay fixed across cards, charts, and future exports. Subscription revenue
        remains unavailable until real subscription billing is connected.
      </p>
    </div>
  );
}
