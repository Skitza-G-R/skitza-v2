"use client";

import { useMemo, useState } from "react";

import type { DemoAuditEntry, DemoProblem, DemoSystemHealth } from "~/lib/admin-demo-view-models";
import {
  ActionMenu,
  ConfirmationDialog,
  CopyIdControl,
  PaginationControl,
  useDashboardFeedback,
} from "./dashboard-interactions";
import styles from "./dashboard.module.css";
import {
  filterProblems,
  paginateItems,
  type ProblemSeverityFilter,
  type ProblemStateFilter,
  transitionProblem,
} from "./operations-demo";
import { Badge, EmptyState, PageHeader, Panel, ProviderStrip } from "./shared";

type ProblemDialog =
  | Readonly<{ kind: "note"; problem: DemoProblem }>
  | Readonly<{ kind: "retry"; problem: DemoProblem }>
  | null;

type AuditOutcomeFilter = "all" | DemoAuditEntry["outcome"];

function problemTone(problem: DemoProblem): "danger" | "success" | "warning" {
  if (problem.state === "Resolved") return "success";
  if (problem.severity === "Critical") return "danger";
  return "warning";
}

function canRetry(problem: DemoProblem): boolean {
  return problem.provider === "Resend";
}

export function SystemHealthView({ data }: { data: DemoSystemHealth }) {
  const { showFeedback } = useDashboardFeedback();
  const [problems, setProblems] = useState(data.problems);
  const [query, setQuery] = useState("");
  const [provider, setProvider] = useState("all");
  const [severity, setSeverity] = useState<ProblemSeverityFilter>("all");
  const [state, setState] = useState<ProblemStateFilter>("all");
  const [page, setPage] = useState(1);
  const [dialog, setDialog] = useState<ProblemDialog>(null);
  const [dialogInput, setDialogInput] = useState("");
  const [notesByProblem, setNotesByProblem] = useState<Readonly<Record<string, readonly string[]>>>(
    {},
  );
  const [auditQuery, setAuditQuery] = useState("");
  const [auditOutcome, setAuditOutcome] = useState<AuditOutcomeFilter>("all");

  const providers = useMemo(
    () => Array.from(new Set(data.problems.map((problem) => problem.provider))).sort(),
    [data.problems],
  );
  const filteredProblems = useMemo(
    () => filterProblems({ problems, query, provider, severity, state }),
    [problems, provider, query, severity, state],
  );
  const pagination = paginateItems(filteredProblems, page, 2);
  const filteredHistory = useMemo(() => {
    const search = auditQuery.trim().toLocaleLowerCase("en-US");

    return data.history.filter(
      (entry) =>
        (auditOutcome === "all" || entry.outcome === auditOutcome) &&
        (search.length === 0 ||
          [entry.id, entry.action, entry.target, entry.actor].some((value) =>
            value.toLocaleLowerCase("en-US").includes(search),
          )),
    );
  }, [auditOutcome, auditQuery, data.history]);

  const updateProblemState = (problem: DemoProblem, nextState: DemoProblem["state"]) => {
    setProblems((current) => transitionProblem(current, problem.id, nextState));
    showFeedback(`${problem.title} marked ${nextState.toLocaleLowerCase("en-US")} · simulated`);
  };

  const resetProblemFilters = () => {
    setQuery("");
    setProvider("all");
    setSeverity("all");
    setState("all");
    setPage(1);
  };

  const openDialog = (nextDialog: Exclude<ProblemDialog, null>) => {
    setDialogInput("");
    setDialog(nextDialog);
  };

  const confirmDialog = () => {
    if (!dialog || !dialogInput.trim()) return;

    if (dialog.kind === "note") {
      setNotesByProblem((current) => ({
        ...current,
        [dialog.problem.id]: [...(current[dialog.problem.id] ?? []), dialogInput.trim()],
      }));
      showFeedback("Private support note added · simulated");
    } else {
      showFeedback(`Safe retry queued for ${dialog.problem.provider} · simulated`);
    }

    setDialogInput("");
  };

  const dialogIsNote = dialog?.kind === "note";

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
        <Panel
          title="Problems inbox"
          meta={`${String(pagination.total)} matching ${
            pagination.total === 1 ? "problem" : "problems"
          }`}
        >
          <div className={styles.panelBody}>
            <div className={styles.toolbar}>
              <input
                aria-label="Search problems"
                className={styles.search}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setPage(1);
                }}
                placeholder="Search problem, provider, or ID…"
                type="search"
                value={query}
              />
              <div className={styles.filters}>
                <select
                  aria-label="Filter problems by state"
                  className={styles.filter}
                  onChange={(event) => {
                    setState(event.target.value as ProblemStateFilter);
                    setPage(1);
                  }}
                  value={state}
                >
                  <option value="all">All states</option>
                  <option value="open">Open only</option>
                  <option value="New">New</option>
                  <option value="Seen">Seen</option>
                  <option value="Resolved">Resolved</option>
                </select>
                <select
                  aria-label="Filter problems by provider"
                  className={styles.filter}
                  onChange={(event) => {
                    setProvider(event.target.value);
                    setPage(1);
                  }}
                  value={provider}
                >
                  <option value="all">All providers</option>
                  {providers.map((providerName) => (
                    <option key={providerName} value={providerName}>
                      {providerName}
                    </option>
                  ))}
                </select>
                <select
                  aria-label="Filter problems by severity"
                  className={styles.filter}
                  onChange={(event) => {
                    setSeverity(event.target.value as ProblemSeverityFilter);
                    setPage(1);
                  }}
                  value={severity}
                >
                  <option value="all">All severities</option>
                  <option value="Critical">Critical</option>
                  <option value="Warning">Warning</option>
                </select>
                <button
                  className={styles.secondaryAction}
                  onClick={resetProblemFilters}
                  type="button"
                >
                  Reset
                </button>
              </div>
            </div>
          </div>

          {pagination.total === 0 ? (
            <EmptyState>No demo problem matches these filters.</EmptyState>
          ) : (
            <>
              <ul className={styles.problemList}>
                {pagination.items.map((problem) => {
                  const notes = notesByProblem[problem.id] ?? [];
                  const stateActions =
                    problem.state === "New"
                      ? [
                          {
                            label: "Mark as seen",
                            onSelect: () => {
                              updateProblemState(problem, "Seen");
                            },
                          },
                          {
                            label: "Resolve problem",
                            onSelect: () => {
                              updateProblemState(problem, "Resolved");
                            },
                          },
                        ]
                      : problem.state === "Seen"
                        ? [
                            {
                              label: "Resolve problem",
                              onSelect: () => {
                                updateProblemState(problem, "Resolved");
                              },
                            },
                            {
                              label: "Mark as new",
                              onSelect: () => {
                                updateProblemState(problem, "New");
                              },
                            },
                          ]
                        : [
                            {
                              label: "Reopen as seen",
                              onSelect: () => {
                                updateProblemState(problem, "Seen");
                              },
                            },
                          ];

                  return (
                    <li className={styles.problemItem} key={problem.id}>
                      <div>
                        <p className={styles.itemTitle}>{problem.title}</p>
                        <p className={styles.itemDetail}>{problem.detail}</p>
                        <div className={styles.problemMeta}>
                          <Badge tone={problemTone(problem)}>{problem.state}</Badge>
                          <Badge>{problem.provider}</Badge>
                          <Badge>{problem.severity}</Badge>
                          <span className={styles.itemTime}>{problem.firstSeenAt}</span>
                          {notes.length > 0 ? (
                            <span className={styles.itemTime}>
                              {notes.length} private {notes.length === 1 ? "note" : "notes"}
                            </span>
                          ) : null}
                        </div>
                      </div>
                      <ActionMenu
                        actions={[
                          ...stateActions,
                          {
                            label: "Add private note",
                            onSelect: () => {
                              openDialog({ kind: "note", problem });
                            },
                          },
                          {
                            disabled: !canRetry(problem),
                            label: canRetry(problem)
                              ? "Retry safe operation"
                              : "Retry not supported",
                            onSelect: () => {
                              openDialog({ kind: "retry", problem });
                            },
                          },
                          {
                            label: "Copy problem ID",
                            onSelect: () => {
                              void navigator.clipboard
                                .writeText(problem.id)
                                .then(() => {
                                  showFeedback("Problem ID copied");
                                })
                                .catch(() => {
                                  showFeedback("Copy failed. Try again.", "danger");
                                });
                            },
                          },
                        ]}
                        label={`Actions for ${problem.title}`}
                      />
                    </li>
                  );
                })}
              </ul>
              <div className={styles.panelBody}>
                <PaginationControl
                  currentPage={pagination.page}
                  onPageChange={setPage}
                  pageSize={2}
                  totalItems={pagination.total}
                />
              </div>
            </>
          )}
        </Panel>

        <Panel title="Admin history" meta="Immutable · 90-day retention">
          <div className={styles.panelBody}>
            <div className={styles.toolbar}>
              <input
                aria-label="Search admin history"
                className={styles.search}
                onChange={(event) => {
                  setAuditQuery(event.target.value);
                }}
                placeholder="Search action, target, actor, or ID…"
                type="search"
                value={auditQuery}
              />
              <select
                aria-label="Filter admin history by outcome"
                className={styles.filter}
                onChange={(event) => {
                  setAuditOutcome(event.target.value as AuditOutcomeFilter);
                }}
                value={auditOutcome}
              >
                <option value="all">All outcomes</option>
                <option value="Succeeded">Succeeded</option>
                <option value="Failed">Failed</option>
              </select>
            </div>
          </div>

          {filteredHistory.length === 0 ? (
            <EmptyState>No immutable history entry matches this search.</EmptyState>
          ) : (
            <ul className={styles.auditList}>
              {filteredHistory.map((entry) => (
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
                  <CopyIdControl
                    label="Copy event ID"
                    successMessage="Event ID copied"
                    value={entry.id}
                  />
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <p className={styles.paymentNote}>
        Demo mode keeps provider links, state changes, private notes, retries, and alerts inert.
        History is append-only and cannot be edited or deleted.
      </p>

      <ConfirmationDialog
        confirmDisabled={!dialogInput.trim()}
        confirmLabel={dialogIsNote ? "Add private note" : "Run simulated retry"}
        description={
          dialogIsNote
            ? "This note is appended to the demo problem. Existing notes and history remain unchanged."
            : "Only the explicitly supported Resend retry is shown. This demo does not contact Resend."
        }
        onClose={() => {
          setDialog(null);
          setDialogInput("");
        }}
        onConfirm={confirmDialog}
        open={dialog !== null}
        title={
          dialogIsNote
            ? `Add a note to ${dialog.problem.title}`
            : `Retry ${dialog?.problem.provider ?? "operation"}?`
        }
      >
        <label className={styles.dialogField}>
          {dialogIsNote ? "Private note" : "Reason"}
          <textarea
            autoFocus
            className={styles.dialogTextarea}
            onChange={(event) => {
              setDialogInput(event.target.value);
            }}
            placeholder={
              dialogIsNote ? "Add context for the next founder…" : "Why is this retry needed?"
            }
            rows={4}
            value={dialogInput}
          />
        </label>
      </ConfirmationDialog>
    </div>
  );
}
