"use client";

import Link from "next/link";
import { useState } from "react";

import { Badge } from "~/components/ui/badge";
import { withArtistStudio } from "~/lib/artist-studio-context";
import { formatMoney } from "~/lib/format/money";
import type {
  PaymentHistoryProject,
  PaymentHistoryPurchase,
  PaymentHistoryViewData,
} from "~/components/payments/payment-history-view";

export function ArtistPaymentsOverview({
  sections,
}: {
  sections: readonly [
    waiting: PaymentHistoryViewData,
    active: PaymentHistoryViewData,
    history: PaymentHistoryViewData,
  ];
}) {
  const tabs = [
    {
      key: "waiting",
      label: "Waiting",
      data: sections[0],
    },
    {
      key: "active",
      label: "Balance & actions",
      data: sections[1],
    },
    {
      key: "history",
      label: "History",
      data: sections[2],
    },
  ] as const;
  type TabKey = (typeof tabs)[number]["key"];
  const [activeTab, setActiveTab] = useState<TabKey>(() =>
    hasPurchaseRequiringPayment(sections[0]) ? "waiting" : "active",
  );
  const activeIndex = tabs.findIndex((tab) => tab.key === activeTab);
  const active = tabs[activeIndex] ?? tabs[0];

  return (
    <div>
      <nav aria-label="Payment sections" className="mb-5">
        <div
          role="tablist"
          aria-label="Payment sections"
          className="grid grid-cols-3 gap-1 rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-overlay)/0.6)] p-1"
        >
          {tabs.map((tab, index) => {
            const selected = tab.key === activeTab;
            const count = purchaseCount(tab.data);
            const countLabel = `${String(count)} ${count === 1 ? "purchase" : "purchases"}`;

            return (
              <button
                key={tab.key}
                id={`artist-payments-${tab.key}-tab`}
                type="button"
                role="tab"
                aria-label={`${tab.label}, ${countLabel}`}
                aria-selected={selected}
                aria-controls="artist-payments-tab-panel"
                tabIndex={selected ? 0 : -1}
                onClick={() => {
                  setActiveTab(tab.key);
                }}
                onKeyDown={(event) => {
                  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
                  event.preventDefault();
                  const nextIndex =
                    event.key === "Home"
                      ? 0
                      : event.key === "End"
                        ? tabs.length - 1
                        : event.key === "ArrowRight"
                          ? (index + 1) % tabs.length
                          : (index - 1 + tabs.length) % tabs.length;
                  const nextTab = tabs[nextIndex];
                  if (!nextTab) return;
                  setActiveTab(nextTab.key);
                  document.getElementById(`artist-payments-${nextTab.key}-tab`)?.focus();
                }}
                className={`sk-press flex min-h-11 min-w-0 items-center justify-center gap-1.5 rounded-[var(--radius-lg)] px-1.5 text-center text-[10.5px] leading-tight font-bold transition-[background,color,box-shadow] focus-visible:ring-2 focus-visible:ring-[rgb(var(--focus-ring))] focus-visible:outline-none motion-reduce:transition-none sm:px-3 sm:text-[12.5px] ${
                  selected
                    ? "bg-[rgb(var(--bg-sidebar))] text-[rgb(var(--fg-onsidebar))] shadow-[0_4px_14px_rgb(17_16_9/0.14)]"
                    : "text-[rgb(var(--fg-muted))] hover:bg-[rgb(var(--bg-elevated))] hover:text-[rgb(var(--fg-default))]"
                }`}
              >
                <span className="min-w-0">{tab.label}</span>
                <span
                  aria-hidden="true"
                  className={`shrink-0 font-mono text-[9px] tabular-nums ${
                    selected
                      ? "text-[rgb(var(--fg-onsidebar)/0.68)]"
                      : "text-[rgb(var(--fg-subtle))]"
                  }`}
                >
                  {String(count)}
                </span>
              </button>
            );
          })}
        </div>
      </nav>

      <div
        id="artist-payments-tab-panel"
        role="tabpanel"
        aria-labelledby={`artist-payments-${active.key}-tab`}
      >
        <ArtistPaymentSection data={active.data} />
      </div>
    </div>
  );
}

function purchaseCount(data: PaymentHistoryViewData): number {
  return data.projects.reduce((total, project) => total + project.purchases.length, 0);
}

function hasPurchaseRequiringPayment(data: PaymentHistoryViewData): boolean {
  return data.projects.some((project) =>
    project.purchases.some((purchase) => purchase.showPayNextPayment),
  );
}

function ArtistPaymentSection({ data }: { data: PaymentHistoryViewData }) {
  const rows = data.projects.flatMap((project) =>
    project.purchases.map((purchase) => ({ project, purchase })),
  );
  const headingId = `artist-payments-${data.section.id}`;

  return (
    <section aria-labelledby={headingId}>
      <header className="mb-3 border-b border-[rgb(var(--border-subtle))] pb-2.5">
        <h2
          id={headingId}
          className="font-display text-[19px] font-bold tracking-[-0.025em] text-[rgb(var(--fg-default))]"
        >
          {data.section.title}
        </h2>
      </header>

      {rows.length === 0 ? (
        <div className="rounded-[var(--radius-lg)] border border-dashed border-[rgb(var(--border-subtle))] px-4 py-6">
          <p className="text-[13px] font-semibold text-[rgb(var(--fg-default))]">
            {data.section.emptyTitle}
          </p>
          <p className="mt-1 text-[11.5px] leading-relaxed text-[rgb(var(--fg-muted))]">
            {data.section.emptyDescription}
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))]">
          <ul className="list-none divide-y divide-[rgb(var(--border-subtle))]">
            {rows.map(({ project, purchase }) => (
              <ArtistPaymentRow
                key={`${project.id}-${purchase.id}`}
                project={project}
                purchase={purchase}
              />
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function ArtistPaymentRow({
  project,
  purchase,
}: {
  project: PaymentHistoryProject;
  purchase: PaymentHistoryPurchase;
}) {
  const proofCount = purchase.proofs.length;

  return (
    <li>
      <Link
        href={withArtistStudio(
          `/artist/payments/${encodeURIComponent(purchase.id)}`,
          purchase.studioId,
        )}
        className="sk-press block px-4 py-4 transition-colors hover:bg-[rgb(var(--bg-background)/0.55)] focus-visible:ring-2 focus-visible:ring-[rgb(var(--focus-ring))] focus-visible:outline-none focus-visible:ring-inset sm:px-5"
      >
        <span className="flex min-w-0 items-start justify-between gap-3">
          <span className="min-w-0">
            <span className="block truncate text-[10.5px] font-semibold text-[rgb(var(--fg-muted))]">
              {[project.title, purchase.counterpartyLabel].filter(Boolean).join(" · ")}
            </span>
            <span className="mt-1 block text-[15px] font-bold break-words text-[rgb(var(--fg-default))]">
              {purchase.title}
            </span>
          </span>
          <Badge className="shrink-0" dot variant={purchase.status.tone}>
            {purchase.status.label}
          </Badge>
        </span>

        <span className="mt-3 grid grid-cols-2 gap-4 border-t border-[rgb(var(--border-subtle))] pt-3">
          <Amount
            label="Due now"
            cents={purchase.dueNowCents}
            currency={purchase.currency}
            urgent={purchase.dueNowCents > 0}
          />
          <Amount
            label="Remaining"
            cents={purchase.totalRemainingCents}
            currency={purchase.currency}
          />
        </span>

        <span className="mt-3 flex min-w-0 items-center justify-between gap-3">
          <span className="text-[10.5px] text-[rgb(var(--fg-muted))]">
            {String(proofCount)} proof {proofCount === 1 ? "record" : "records"}
          </span>
          <span className="text-right text-[11.5px] font-bold text-[rgb(var(--brand-primary-text))]">
            {artistPaymentActionLabel(purchase)} →
          </span>
        </span>
      </Link>
    </li>
  );
}

function artistPaymentActionLabel(purchase: PaymentHistoryPurchase): string {
  if (purchase.recordStatus === "canceled") return "View closed record";
  if (purchase.recordStatus === "no_payment_required") return "View agreement";
  if (purchase.recordStatus === "settled_by_waiver") return "View settlement history";
  if (purchase.recordStatus === "paid_in_full") return "View payment history";
  return purchase.showPayNextPayment ? "Pay & upload proof" : "View payment record";
}

function Amount({
  label,
  cents,
  currency,
  urgent = false,
}: {
  label: string;
  cents: number;
  currency: string;
  urgent?: boolean;
}) {
  return (
    <span className="min-w-0">
      <span className="block text-[9px] font-semibold tracking-[0.08em] text-[rgb(var(--fg-muted))] uppercase">
        {label}
      </span>
      <span
        className="mt-0.5 block font-mono text-[14px] font-bold tabular-nums"
        style={{
          color: urgent ? "rgb(var(--fg-danger-text))" : "rgb(var(--fg-default))",
        }}
      >
        {formatMoney(cents, currency)}
      </span>
    </span>
  );
}
