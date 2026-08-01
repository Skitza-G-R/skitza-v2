"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import type { DemoPayment, DemoPayments } from "~/lib/admin-demo-view-models";
import {
  ActionMenu,
  ConfirmationDialog,
  CopyIdControl,
  PaginationControl,
  useDashboardFeedback,
} from "./dashboard-interactions";
import styles from "./dashboard.module.css";
import {
  filterAndSortPayments,
  paginateItems,
  type PaymentCurrencyFilter,
  type PaymentSort,
  type PaymentStateFilter,
  type PaymentView,
} from "./operations-demo";
import { Badge, MetricLedger, PageHeader, Panel } from "./shared";

function paymentTone(state: DemoPayment["state"]): "success" | "warning" {
  return state === "Approved" ? "success" : "warning";
}

export function PaymentsView({ data, view }: { data: DemoPayments; view: PaymentView }) {
  const base = `/${data.environment}/payments`;
  const router = useRouter();
  const { showFeedback } = useDashboardFeedback();
  const [attentionOnly, setAttentionOnly] = useState(view === "attention");
  const [query, setQuery] = useState("");
  const [currency, setCurrency] = useState<PaymentCurrencyFilter>("all");
  const [state, setState] = useState<PaymentStateFilter>("all");
  const [sort, setSort] = useState<PaymentSort>("updated-desc");
  const [page, setPage] = useState(1);

  const filteredPayments = useMemo(
    () =>
      filterAndSortPayments({
        payments: data.payments,
        query,
        currency,
        state,
        attentionOnly,
        sort,
      }),
    [attentionOnly, currency, data.payments, query, sort, state],
  );
  const pagination = paginateItems(filteredPayments, page, 2);

  const resetFilters = () => {
    setAttentionOnly(false);
    setQuery("");
    setCurrency("all");
    setState("all");
    setSort("updated-desc");
    setPage(1);
  };

  const copyPaymentId = async (paymentId: string) => {
    try {
      await navigator.clipboard.writeText(paymentId);
      showFeedback("Payment ID copied · simulated record");
    } catch {
      showFeedback("Copy failed. Try again.", "danger");
    }
  };

  return (
    <div className={styles.page}>
      <PageHeader
        eyebrow="Payment operations"
        title="Payments."
        description="Investigate payment proof and inconsistent states without pretending verification proves a bank transfer settled."
        updatedAt={data.updatedAt}
      />

      <div className={styles.viewTabs} aria-label="Payment views">
        <button
          className={styles.viewTab}
          data-active={attentionOnly}
          onClick={() => {
            setAttentionOnly(true);
            setPage(1);
          }}
          type="button"
        >
          Needs attention
        </button>
        <button
          className={styles.viewTab}
          data-active={!attentionOnly}
          onClick={() => {
            setAttentionOnly(false);
            setPage(1);
          }}
          type="button"
        >
          All payments
        </button>
      </div>

      <MetricLedger label="Currency-separated payment summaries" metrics={data.totals} />

      <p className={styles.paymentNote}>
        “Verified sales recorded in Skitza” means eligible proof was approved in the product. It
        does not confirm that money settled in a bank. Admin payment tools remain
        investigation-only.
      </p>

      <div className={styles.toolbar}>
        <input
          aria-label="Search payment records"
          className={styles.search}
          onChange={(event) => {
            setQuery(event.target.value);
            setPage(1);
          }}
          placeholder="Search project, producer, artist, or payment ID…"
          type="search"
          value={query}
        />
        <div className={styles.filters}>
          <select
            aria-label="Filter payments by currency"
            className={styles.filter}
            onChange={(event) => {
              setCurrency(event.target.value as PaymentCurrencyFilter);
              setPage(1);
            }}
            value={currency}
          >
            <option value="all">All currencies</option>
            <option value="ILS">ILS</option>
            <option value="USD">USD</option>
          </select>
          <select
            aria-label="Filter payments by state"
            className={styles.filter}
            onChange={(event) => {
              setState(event.target.value as PaymentStateFilter);
              setPage(1);
            }}
            value={state}
          >
            <option value="all">All states</option>
            <option value="Proof submitted">Proof submitted</option>
            <option value="Proof rejected">Proof rejected</option>
            <option value="Needs producer approval">Needs producer approval</option>
            <option value="Approved">Approved</option>
          </select>
          <select
            aria-label="Sort payments"
            className={styles.filter}
            onChange={(event) => {
              setSort(event.target.value as PaymentSort);
              setPage(1);
            }}
            value={sort}
          >
            <option value="updated-desc">Newest activity</option>
            <option value="project-asc">Project A–Z</option>
            <option value="amount-desc">Amount high–low</option>
          </select>
          <button className={styles.secondaryAction} onClick={resetFilters} type="button">
            Reset
          </button>
        </div>
      </div>

      <p className={styles.panelMeta}>
        {pagination.total} matching {pagination.total === 1 ? "record" : "records"} · simulated data
      </p>

      {pagination.total === 0 ? (
        <Panel title="No matching payments" meta="Reset filters to see all records">
          <div className={styles.empty}>No demo payment matches these filters.</div>
        </Panel>
      ) : (
        <>
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
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {pagination.items.map((payment, index) => (
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
                    <td>
                      <ActionMenu
                        actions={[
                          {
                            label: "Open payment",
                            onSelect: () => {
                              router.push(`${base}/${payment.id}`);
                            },
                          },
                          {
                            label: "Copy payment ID",
                            onSelect: () => void copyPaymentId(payment.id),
                          },
                        ]}
                        label={`Actions for ${payment.project}`}
                        placement={index === pagination.items.length - 1 ? "up" : "down"}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className={styles.mobileCards} aria-label="Payment records">
            {pagination.items.map((payment) => (
              <article className={styles.mobileCard} key={payment.id}>
                <div>
                  <Link className={styles.recordLink} href={`${base}/${payment.id}`}>
                    {payment.project}
                  </Link>
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
                <ActionMenu
                  actions={[
                    {
                      label: "Open payment",
                      onSelect: () => {
                        router.push(`${base}/${payment.id}`);
                      },
                    },
                    {
                      label: "Copy payment ID",
                      onSelect: () => void copyPaymentId(payment.id),
                    },
                  ]}
                  label={`Actions for ${payment.project}`}
                />
              </article>
            ))}
          </div>

          <PaginationControl
            currentPage={pagination.page}
            onPageChange={setPage}
            pageSize={2}
            totalItems={pagination.total}
          />
        </>
      )}
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
  const { showFeedback } = useDashboardFeedback();
  const [retryOpen, setRetryOpen] = useState(false);
  const [reason, setReason] = useState("");

  return (
    <div className={styles.page}>
      <PageHeader
        eyebrow="Payment record"
        title={payment.project}
        description="Investigate the immutable payment trail. Business decisions remain with the producer; admin actions cannot rewrite payment history."
        updatedAt={payment.updatedAt}
      />

      <div className={styles.profileGrid}>
        <div className={styles.page}>
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

          <Panel title="Immutable timeline" meta={`${String(payment.timeline.length)} events`}>
            <ul className={styles.activityList}>
              {payment.timeline.map((event) => (
                <li className={styles.activityItem} key={event.id}>
                  <span className={styles.activityDot} data-tone={event.tone} aria-hidden="true" />
                  <div>
                    <p className={styles.itemTitle}>{event.label}</p>
                    <p className={styles.itemDetail}>{event.detail}</p>
                  </div>
                  <span className={styles.itemTime}>{event.occurredAt}</span>
                </li>
              ))}
            </ul>
          </Panel>
        </div>

        <aside className={styles.actionRail}>
          <header className={styles.actionRailHeader}>
            <h3>Investigation tools</h3>
            <p>Simulated only. No payment state or money can be changed here.</p>
          </header>
          <div className={styles.actionList}>
            <CopyIdControl successMessage="Payment ID copied" value={payment.id} />
            <Link
              className={styles.secondaryAction}
              href={`/${environment}/users/${payment.producerUserId}`}
            >
              Open producer profile
            </Link>
            <button
              className={styles.secondaryAction}
              onClick={() => {
                showFeedback("Evidence viewer opened · simulated");
              }}
              type="button"
            >
              Inspect proof evidence
            </button>
            <button
              className={styles.primaryAction}
              disabled={!payment.retrySupported}
              onClick={() => {
                if (payment.retrySupported) setRetryOpen(true);
              }}
              title={
                payment.retrySupported
                  ? "Retry the supported failed callback"
                  : "No retry-safe failure is recorded for this payment"
              }
              type="button"
            >
              {payment.retrySupported ? "Retry supported callback" : "No retry-safe failure"}
            </button>
          </div>
        </aside>
      </div>

      <ConfirmationDialog
        confirmDisabled={!reason.trim()}
        confirmLabel="Run simulated retry"
        description="This demonstrates an idempotent retry-safe operation. It does not contact a payment provider or change the payment."
        onClose={() => {
          setRetryOpen(false);
          setReason("");
        }}
        onConfirm={() => {
          showFeedback(
            `Callback retry queued · simulated${reason.trim() ? ` · ${reason.trim()}` : ""}`,
          );
          setReason("");
        }}
        open={retryOpen}
        title="Retry supported callback?"
      >
        <label className={styles.itemDetail}>
          Reason
          <input
            className={styles.search}
            onChange={(event) => {
              setReason(event.target.value);
            }}
            placeholder="Why is this retry needed?"
            value={reason}
          />
        </label>
      </ConfirmationDialog>
    </div>
  );
}
