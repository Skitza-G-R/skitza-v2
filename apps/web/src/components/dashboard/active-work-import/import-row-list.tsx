"use client";

import { Check, ChevronRight, CircleAlert, Plus } from "lucide-react";

import {
  draftTaxBreakdown,
  formatImportMoney,
  isRowReady,
  paidCents,
  paymentPlanLabel,
  type ArchivedClientOption,
  type ExistingClientOption,
  type WorkspaceImportRow,
} from "./model";

export function ImportRowList({
  rows,
  clients,
  archivedClients,
  selectedOperationKey,
  canAdd,
  addDisabled,
  onSelect,
  onAdd,
}: {
  rows: readonly WorkspaceImportRow[];
  clients: readonly ExistingClientOption[];
  archivedClients: readonly ArchivedClientOption[];
  selectedOperationKey: string | null;
  canAdd: boolean;
  addDisabled: boolean;
  onSelect: (operationKey: string, trigger: HTMLButtonElement) => void;
  onAdd: () => void;
}) {
  if (rows.length === 0) {
    return (
      <section className="overflow-hidden rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] shadow-[var(--shadow-sm)] lg:h-full">
        <div className="p-5">
          <h2 className="text-[15px] font-bold text-[rgb(var(--fg-default))]">
            {canAdd ? "No active work added yet" : "Setup complete"}
          </h2>
          <p className="mt-1.5 text-[12px] leading-relaxed text-[rgb(var(--fg-muted))]">
            {canAdd
              ? "Add one client, project, and agreement. Your draft saves quietly."
              : "There are no unfinished items."}
          </p>
        </div>
        {canAdd ? (
          <div className="border-t border-[rgb(var(--border-subtle))] p-3">
            <button
              type="button"
              onClick={onAdd}
              disabled={addDisabled}
              className="sk-press inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-[var(--radius-lg)] bg-[rgb(var(--brand-primary))] px-4 text-[14px] font-bold text-[rgb(var(--fg-on-brand))] disabled:opacity-50"
            >
              <Plus size={17} strokeWidth={2.3} aria-hidden />
              Add first item
            </button>
          </div>
        ) : null}
      </section>
    );
  }

  return (
    <section
      data-active-import-queue="compact-table"
      className="flex min-w-0 flex-col overflow-hidden rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] shadow-[var(--shadow-sm)] lg:h-full lg:min-h-0"
    >
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-[rgb(var(--border-subtle))] px-3 py-2.5">
        <div className="min-w-0">
          <h2 className="truncate text-[13px] font-bold text-[rgb(var(--fg-default))]">
            Work queue
          </h2>
          <p className="mt-0.5 text-[10.5px] text-[rgb(var(--fg-muted))]">
            Rows stay in this order
          </p>
        </div>
        {canAdd ? (
          <button
            type="button"
            onClick={onAdd}
            disabled={addDisabled}
            className="sk-press inline-flex min-h-11 items-center gap-1.5 rounded-[var(--radius-lg)] px-3 text-[12px] font-bold text-[rgb(var(--fg-default))] hover:bg-[rgb(var(--bg-overlay))] disabled:opacity-50 sm:min-h-9 sm:rounded-[var(--radius-md)]"
          >
            <Plus size={14} strokeWidth={2.4} aria-hidden />
            Add item
          </button>
        ) : null}
      </header>

      <div
        aria-hidden
        className="hidden shrink-0 grid-cols-[minmax(0,1.45fr)_minmax(5.5rem,0.78fr)_minmax(5.75rem,0.85fr)_minmax(5.3rem,0.72fr)_1rem] gap-2 border-b border-[rgb(var(--border-subtle))] px-3 py-2 font-mono text-[9px] font-bold tracking-[0.1em] text-[rgb(var(--fg-muted))] uppercase lg:grid"
      >
        <span>Client / Project</span>
        <span>Agreement</span>
        <span>Payment</span>
        <span>State</span>
        <span />
      </div>

      <ul
        aria-label="Active work items"
        className="min-h-0 divide-y divide-[rgb(var(--border-subtle))] lg:flex-1 lg:overflow-y-auto"
      >
        {rows.map((row, index) => {
          const ready =
            !row.materializeError &&
            isRowReady(row.assessment, row.draft, clients, archivedClients);
          const created = row.materializedAtIso !== null;
          const total = draftTaxBreakdown(row.draft).totalCents;
          const paid = paidCents(row.draft);
          const remaining = total === null ? null : Math.max(0, total - paid);
          const selected = selectedOperationKey === row.operationKey;
          const currency = row.draft.agreement.currency || "USD";
          const stateLabel = created ? "Created" : ready ? "Ready" : "Needs info";
          const clientName = row.draft.client.name.trim() || "New client";
          const projectTitle = row.draft.project.title.trim() || "Untitled project";
          return (
            <li key={row.operationKey}>
              <button
                type="button"
                aria-current={selected ? "true" : undefined}
                onClick={(event) => {
                  onSelect(row.operationKey, event.currentTarget);
                }}
                title={`${clientName} — ${projectTitle}`}
                data-import-row-state={stateLabel.toLowerCase().replace(" ", "-")}
                className={`sk-press-row relative grid min-h-[82px] w-full min-w-0 grid-cols-[1.5rem_minmax(0,1fr)_auto] items-center gap-2 px-3 py-2.5 text-left transition-[background-color,transform] duration-150 motion-reduce:transition-none lg:min-h-[64px] lg:grid-cols-[minmax(0,1.45fr)_minmax(5.5rem,0.78fr)_minmax(5.75rem,0.85fr)_minmax(5.3rem,0.72fr)_1rem] lg:gap-2 lg:py-2 ${
                  selected
                    ? "bg-[rgb(var(--brand-primary)/0.1)]"
                    : created
                      ? "bg-[rgb(var(--bg-background)/0.7)] hover:bg-[rgb(var(--bg-overlay))]"
                      : "bg-[rgb(var(--bg-elevated))] hover:bg-[rgb(var(--bg-overlay))]"
                }`}
              >
                {selected ? (
                  <span
                    aria-hidden
                    className="absolute inset-y-2.5 left-0 w-[3px] rounded-r-full bg-[rgb(var(--brand-primary))]"
                  />
                ) : null}
                <span className="font-mono text-[9px] font-semibold text-[rgb(var(--fg-faint))] lg:hidden">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <span className={`min-w-0 ${created ? "opacity-65" : ""}`}>
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="hidden font-mono text-[9px] font-semibold text-[rgb(var(--fg-faint))] lg:inline">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <span className="truncate text-[12.5px] font-bold text-[rgb(var(--fg-default))]">
                      {clientName}
                    </span>
                  </span>
                  <span className="mt-0.5 block truncate text-[12px] text-[rgb(var(--fg-secondary))] lg:pl-[1.55rem]">
                    {projectTitle}
                  </span>
                  {row.saveState === "saving" ? (
                    <span
                      role="status"
                      className="mt-0.5 block text-[9.5px] text-[rgb(var(--fg-muted))] lg:pl-[1.55rem]"
                    >
                      Saving…
                    </span>
                  ) : row.saveState === "error" ? (
                    <span
                      role="status"
                      className="mt-0.5 block text-[9.5px] text-[rgb(var(--fg-danger-text))] lg:pl-[1.55rem]"
                    >
                      Could not save — try again
                    </span>
                  ) : row.saveState === "unchecked" ? (
                    <span
                      role="status"
                      className="mt-0.5 block text-[9.5px] text-[rgb(var(--fg-warning-text))] lg:pl-[1.55rem]"
                    >
                      Saved, but not checked yet
                    </span>
                  ) : null}
                </span>

                <span className="hidden min-w-0 lg:block">
                  <span className="font-amount block truncate text-[11.5px] font-semibold text-[rgb(var(--fg-default))]">
                    {total === null ? "—" : formatImportMoney(total, currency)}
                  </span>
                  <span className="mt-0.5 block truncate text-[10px] text-[rgb(var(--fg-muted))]">
                    {paymentPlanLabel(row.draft)}
                  </span>
                </span>

                <span className="hidden min-w-0 lg:block">
                  <span className="font-amount block truncate text-[11px] font-semibold text-[rgb(var(--fg-default))]">
                    {formatImportMoney(paid, currency)} paid
                  </span>
                  <span className="mt-0.5 block truncate text-[10px] text-[rgb(var(--fg-muted))]">
                    {remaining === null
                      ? "—"
                      : paid > (total ?? 0)
                        ? `${formatImportMoney(paid - (total ?? 0), currency)} over`
                        : `${formatImportMoney(remaining, currency)} left`}
                  </span>
                </span>

                <span
                  className={`hidden min-w-0 items-center gap-1.5 text-[10.5px] font-bold lg:inline-flex ${
                    created
                      ? "text-[rgb(var(--fg-muted))]"
                      : ready
                        ? "text-[rgb(var(--fg-success-text))]"
                        : "text-[rgb(var(--fg-warning-text))]"
                  }`}
                >
                  {created || ready ? (
                    <Check size={12} strokeWidth={2.5} aria-hidden />
                  ) : (
                    <CircleAlert size={12} strokeWidth={2.2} aria-hidden />
                  )}
                  <span className="truncate">{stateLabel}</span>
                </span>

                <span className="flex min-w-[6.8rem] flex-col items-end gap-1 lg:hidden">
                  <span className="font-amount text-[11px] font-semibold text-[rgb(var(--fg-default))]">
                    {total === null ? "—" : formatImportMoney(total, currency)}
                  </span>
                  <span className="font-amount text-[10px] text-[rgb(var(--fg-muted))]">
                    {formatImportMoney(paid, currency)} paid
                  </span>
                  <span
                    className={`inline-flex items-center gap-1 text-[10px] font-bold ${
                      created
                        ? "text-[rgb(var(--fg-muted))]"
                        : ready
                          ? "text-[rgb(var(--fg-success-text))]"
                          : "text-[rgb(var(--fg-warning-text))]"
                    }`}
                  >
                    {created || ready ? (
                      <Check size={11} strokeWidth={2.5} aria-hidden />
                    ) : (
                      <CircleAlert size={11} strokeWidth={2.2} aria-hidden />
                    )}
                    {stateLabel}
                  </span>
                </span>
                <ChevronRight
                  size={14}
                  strokeWidth={2}
                  aria-hidden
                  className="hidden shrink-0 text-[rgb(var(--fg-faint))] lg:block"
                />
              </button>
            </li>
          );
        })}
      </ul>
      <footer className="hidden shrink-0 border-t border-[rgb(var(--border-subtle))] px-3 py-2 text-[10px] text-[rgb(var(--fg-muted))] lg:block">
        Showing {String(rows.length)} of {String(rows.length)} items
      </footer>
    </section>
  );
}
