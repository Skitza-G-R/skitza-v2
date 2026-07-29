import type { ReactNode } from "react";

import type {
  DemoChartPoint,
  DemoMetric,
  DemoProvider,
  StatusTone,
} from "~/lib/admin-demo-view-models";
import styles from "./dashboard.module.css";

export function PageHeader({
  eyebrow,
  title,
  description,
  updatedAt,
}: {
  eyebrow: string;
  title: string;
  description: string;
  updatedAt: string;
}) {
  return (
    <header className={styles.pageHeader}>
      <div className={styles.pageHeading}>
        <p className={styles.eyebrow}>{eyebrow}</p>
        <h1 className={styles.title}>{title}</h1>
        <p className={styles.subtitle}>{description}</p>
      </div>
      <div className={styles.headerMeta}>
        <DemoNotice />
        <span className={styles.updated}>Updated {updatedAt}</span>
      </div>
    </header>
  );
}

export function DemoNotice() {
  return (
    <span className={styles.demoNotice}>
      <span className={styles.demoDot} aria-hidden="true" />
      Demo data · no actions connected
    </span>
  );
}

export function MetricLedger({
  metrics,
  label,
}: {
  metrics: readonly DemoMetric[];
  label: string;
}) {
  return (
    <section className={styles.metricLedger} aria-label={label}>
      {metrics.map((metric) => (
        <article className={styles.metricCell} data-tone={metric.tone} key={metric.id}>
          <p className={styles.metricLabel}>{metric.label}</p>
          <p className={styles.metricValue}>{metric.value}</p>
          <p className={styles.metricDetail}>{metric.detail}</p>
          {metric.change ? (
            <span className={styles.metricChange} data-direction={metric.direction}>
              {metric.change}
            </span>
          ) : null}
        </article>
      ))}
    </section>
  );
}

export function Panel({
  title,
  meta,
  children,
  className,
}: {
  title: string;
  meta?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={[styles.panel, className]
        .filter((value): value is string => Boolean(value))
        .join(" ")}
    >
      <header className={styles.panelHeader}>
        <h2 className={styles.panelTitle}>{title}</h2>
        {meta ? <span className={styles.panelMeta}>{meta}</span> : null}
      </header>
      {children}
    </section>
  );
}

export function BarChart({
  points,
  maximum,
  label,
  secondaryLabel,
}: {
  points: readonly DemoChartPoint[];
  maximum?: number;
  label: string;
  secondaryLabel?: string;
}) {
  const highest =
    maximum ?? Math.max(1, ...points.flatMap((point) => [point.value, point.secondaryValue ?? 0]));

  return (
    <div className={styles.chart} role="group" aria-label={label}>
      <div className={styles.chartBars} aria-hidden="true">
        {points.map((point) => (
          <div className={styles.barGroup} key={point.label}>
            <span
              className={styles.bar}
              style={{
                height: String(Math.max(4, (point.value / highest) * 100)) + "%",
              }}
              title={point.label + ": " + String(point.value)}
            />
            {point.secondaryValue === undefined ? null : (
              <span
                className={[styles.bar, styles.barSecondary]
                  .filter((value): value is string => Boolean(value))
                  .join(" ")}
                style={{
                  height: String(Math.max(4, (point.secondaryValue / highest) * 100)) + "%",
                }}
                title={[
                  point.label,
                  secondaryLabel ?? "comparison",
                  String(point.secondaryValue),
                ].join(" ")}
              />
            )}
          </div>
        ))}
      </div>
      <div className={styles.chartLabels}>
        {points.map((point) => (
          <span className={styles.chartPoint} key={point.label}>
            <span>{point.label}</span>
            <strong className={styles.chartPointValue}>
              {point.value.toLocaleString("en-US")}
              {point.secondaryValue === undefined
                ? ""
                : ` / ${point.secondaryValue.toLocaleString("en-US")}`}
            </strong>
          </span>
        ))}
      </div>
      <span className={styles.definition}>
        {label}
        {secondaryLabel ? ` · muted bars: ${secondaryLabel}` : ""}
      </span>
    </div>
  );
}

export function ProviderStrip({ providers }: { providers: readonly DemoProvider[] }) {
  return (
    <section className={styles.providerStrip} aria-label="Provider status">
      {providers.map((provider) => (
        <article className={styles.provider} key={provider.id}>
          <strong className={styles.providerName}>
            <span className={styles.providerDot} data-status={provider.status} aria-hidden="true" />
            {provider.name}
          </strong>
          <span className={styles.providerDetail}>
            {provider.status} · {provider.detail}
          </span>
        </article>
      ))}
    </section>
  );
}

export function Badge({ children, tone = "muted" }: { children: ReactNode; tone?: StatusTone }) {
  return (
    <span className={styles.badge} data-tone={tone}>
      {children}
    </span>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <div className={styles.empty}>{children}</div>;
}
