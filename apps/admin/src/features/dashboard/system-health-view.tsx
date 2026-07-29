import type { DemoProblem, DemoSystemHealth } from "~/lib/admin-demo-view-models";
import styles from "./dashboard.module.css";
import { Badge, PageHeader, Panel, ProviderStrip } from "./shared";

function problemTone(problem: DemoProblem): "danger" | "success" | "warning" {
  if (problem.state === "Resolved") return "success";
  if (problem.severity === "Critical") return "danger";
  return "warning";
}

export function SystemHealthView({ data }: { data: DemoSystemHealth }) {
  return (
    <div className={styles.page}>
      <PageHeader
        eyebrow="Reliability and accountability"
        title="Health & history."
        description="One problems inbox for serious failures, beside a quiet immutable ledger of sensitive founder activity."
        updatedAt={data.updatedAt}
      />

      <ProviderStrip providers={data.providers} />

      <div className={styles.healthGrid}>
        <Panel title="Problems inbox" meta={String(data.problems.length) + " demo records"}>
          <div className={styles.panelBody}>
            <div className={styles.filters} aria-label="Example problem filters">
              <span className={styles.filter} data-active="true">
                All
              </span>
              <span className={styles.filter}>Open</span>
              <span className={styles.filter}>New</span>
              <span className={styles.filter}>Seen</span>
              <span className={styles.filter}>Resolved</span>
            </div>
          </div>
          <ul className={styles.problemList}>
            {data.problems.map((problem) => (
              <li className={styles.problemItem} key={problem.id}>
                <div>
                  <p className={styles.itemTitle}>{problem.title}</p>
                  <p className={styles.itemDetail}>{problem.detail}</p>
                  <div className={styles.problemMeta}>
                    <Badge tone={problemTone(problem)}>{problem.state}</Badge>
                    <Badge>{problem.provider}</Badge>
                    <span className={styles.itemTime}>{problem.firstSeenAt}</span>
                  </div>
                </div>
                <button
                  className={styles.disabledButton}
                  disabled
                  title={data.capability.reason}
                  type="button"
                >
                  Review
                </button>
              </li>
            ))}
          </ul>
        </Panel>

        <Panel title="Admin history" meta="90-day retention">
          <ul className={styles.auditList}>
            {data.history.map((entry) => (
              <li className={styles.auditItem} key={entry.id}>
                <div className={styles.auditTop}>
                  <p className={styles.itemTitle}>{entry.action}</p>
                  <Badge tone={entry.outcome === "Succeeded" ? "success" : "danger"}>
                    {entry.outcome}
                  </Badge>
                </div>
                <span className={styles.auditTarget}>{entry.target}</span>
                <span className={styles.itemTime}>
                  {entry.actor} · {entry.occurredAt}
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      </div>

      <p className={styles.paymentNote}>
        Demo mode keeps provider links, state changes, private notes, and alerts inert. No
        specialist account identifiers appear in this preview.
      </p>
    </div>
  );
}
