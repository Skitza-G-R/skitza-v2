import Link from "next/link";

import type { DemoOverview } from "~/lib/admin-demo-view-models";
import styles from "./dashboard.module.css";
import { BarChart, MetricLedger, PageHeader, Panel, ProviderStrip } from "./shared";

export function OverviewView({ data }: { data: DemoOverview }) {
  return (
    <div className={styles.page}>
      <PageHeader
        eyebrow="Private operations"
        title="Good morning, Gili."
        description="Start with what needs a decision, then scan activation, meaningful work, recorded sales, and system health."
        updatedAt={data.updatedAt}
      />

      <section className={styles.attention} aria-labelledby="attention-title">
        <header className={styles.attentionHeader}>
          <h2 className={styles.attentionTitle} id="attention-title">
            Needs your attention
          </h2>
          <span className={styles.attentionCount}>{data.attention.length}</span>
        </header>
        <ul className={styles.attentionList}>
          {data.attention.map((item) => (
            <li key={item.id}>
              <Link className={styles.attentionItem} href={item.href}>
                <span className={styles.attentionMarker} data-tone={item.tone} aria-hidden="true" />
                <span className={styles.attentionCopy}>
                  <span className={styles.attentionCategory}>{item.category}</span>
                  <strong>{item.title}</strong>
                  <p>{item.detail}</p>
                </span>
                <span className={styles.attentionAge}>{item.age}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <MetricLedger label="Primary operational metrics" metrics={data.metrics} />

      <div className={styles.dashboardGrid}>
        <Panel title="Producer activation" meta="Mature vs provisional cohorts">
          <BarChart
            label="Producer activation rate by weekly cohort"
            maximum={50}
            points={data.activationTrend}
            secondaryLabel="provisional"
          />
        </Panel>

        <Panel title="Recent important activity" meta="Meaningful events only">
          <ul className={styles.activityList}>
            {data.recentActivity.map((activity) => (
              <li className={styles.activityItem} key={activity.id}>
                <span className={styles.activityDot} data-tone={activity.tone} aria-hidden="true" />
                <div>
                  <p className={styles.itemTitle}>{activity.label}</p>
                  <p className={styles.itemDetail}>{activity.detail}</p>
                </div>
                <span className={styles.itemTime}>{activity.occurredAt}</span>
              </li>
            ))}
          </ul>
        </Panel>
      </div>

      <Panel title="Weekly meaningful activity" meta="Trailing seven days">
        <BarChart
          label="Unique producers doing meaningful work per day"
          maximum={100}
          points={data.activityTrend}
        />
      </Panel>

      <ProviderStrip providers={data.providers} />
    </div>
  );
}
