import Link from "next/link";

import type { DemoPayment, DemoPayments } from "~/lib/admin-demo-view-models";
import styles from "./dashboard.module.css";
import { Badge, MetricLedger, PageHeader, Panel } from "./shared";

export type PaymentView = "all" | "attention";

export function parsePaymentView(value: string | undefined): PaymentView {
  return value === "all" ? "all" : "attention";
}

function paymentTone(state: DemoPayment["state"]): "success" | "warning" {
  return state === "Approved" ? "success" : "warning";
}

export function PaymentsView({ data, view }: { data: DemoPayments; view: PaymentView }) {
  const base = `/${data.environment}/payments`;
  const visiblePayments =
    view === "attention"
      ? data.payments.filter((payment) => payment.attentionReason)
      : data.payments;

  return (
    <div className={styles.page}>
      <PageHeader
        eyebrow="Payment operations"
        title="Payments."
        description="Review payment proof and inconsistent states without pretending verification proves a bank transfer settled."
        updatedAt={data.updatedAt}
      />

      <div className={styles.viewTabs} aria-label="Payment views">
        <Link
          aria-current={view === "attention" ? "page" : undefined}
          className={styles.viewTab}
          data-active={view === "attention"}
          href={`${base}?view=attention`}
        >
          Needs attention
        </Link>
        <Link
          aria-current={view === "all" ? "page" : undefined}
          className={styles.viewTab}
          data-active={view === "all"}
          href={`${base}?view=all`}
        >
          All payments
        </Link>
      </div>

      <MetricLedger label="Currency-separated payment summaries" metrics={data.totals} />

      <p className={styles.paymentNote}>
        “Verified sales recorded in Skitza” means eligible proof was approved in the product. It
        does not confirm that money settled in a bank.
      </p>

      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Project</th>
              <th>Producer</th>
              <th>Artist</th>
              <th>Amount</th>
              <th>State</th>
              <th>Updated</th>
            </tr>
          </thead>
          <tbody>
            {visiblePayments.map((payment) => (
              <tr key={payment.id}>
                <td>
                  <Link className={styles.recordLink} href={`${base}/${payment.id}`}>
                    {payment.project}
                  </Link>
                  {payment.attentionReason ? (
                    <p className={styles.itemDetail}>{payment.attentionReason}</p>
                  ) : null}
                </td>
                <td>{payment.producer}</td>
                <td>{payment.artist}</td>
                <td className={styles.metricChange}>{payment.amount}</td>
                <td>
                  <Badge tone={paymentTone(payment.state)}>{payment.state}</Badge>
                </td>
                <td className={styles.itemTime}>{payment.updatedAt}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className={styles.mobileCards} aria-label="Payment records">
        {visiblePayments.map((payment) => (
          <Link className={styles.mobileCard} href={`${base}/${payment.id}`} key={payment.id}>
            <div>
              <p className={styles.itemTitle}>{payment.project}</p>
              <p className={styles.itemDetail}>
                {payment.producer} · {payment.artist}
              </p>
            </div>
            <div className={styles.mobileCardMeta}>
              <strong>{payment.amount}</strong>
              <Badge tone={paymentTone(payment.state)}>{payment.state}</Badge>
            </div>
            {payment.attentionReason ? (
              <p className={styles.itemDetail}>{payment.attentionReason}</p>
            ) : null}
          </Link>
        ))}
      </div>
    </div>
  );
}

export function PaymentDetailView({
  payment,
  environment,
}: {
  payment: DemoPayment;
  environment: DemoPayments["environment"];
}) {
  return (
    <div className={styles.page}>
      <PageHeader
        eyebrow="Payment record"
        title={payment.project}
        description="A focused operational record. Provider actions and real decisions remain disconnected in demo mode."
        updatedAt={payment.updatedAt}
      />

      <div className={styles.profileGrid}>
        <Panel title="Payment context" meta={payment.id}>
          <dl className={styles.detailList}>
            {[
              ["Environment", environment === "live" ? "Live" : "Test"],
              ["Producer", payment.producer],
              ["Artist", payment.artist],
              ["Amount", `${payment.amount} · ${payment.currency}`],
              ["State", payment.state],
              ["Attention reason", payment.attentionReason ?? "No open attention reason"],
              ["Last update", payment.updatedAt],
            ].map(([label, value]) => (
              <div className={styles.detailRow} key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
        </Panel>

        <aside className={styles.actionRail}>
          <header className={styles.actionRailHeader}>
            <h3>Payment controls</h3>
            <p>Demo mode — no real action will run.</p>
          </header>
          <div className={styles.actionList}>
            <button className={styles.disabledButton} disabled type="button">
              Approve proof
            </button>
            <button className={styles.disabledButton} disabled type="button">
              Reject proof
            </button>
            <button className={styles.disabledButton} disabled type="button">
              Retry supported callback
            </button>
          </div>
        </aside>
      </div>
    </div>
  );
}
