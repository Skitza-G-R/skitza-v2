"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";

import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { EmptyState } from "~/components/ui/empty-state";
import { useToast } from "~/components/ui/toast";
import { cn } from "~/lib/cn";
import { cancelContract } from "./actions";

// Contracts list — status-filterable rows of the producer's contracts.
// Each row shows status pill, title, created date, and an Edit/View link.
// Drafts/sent/viewed can be cancelled inline via Server Action.
//
// Styling notes: 44px row height (matches booking table rhythm), tabular
// date column in font-mono so dates align at a glance. Hover tint comes
// from --bg-elevated — consistent with other dashboard lists.

export type ContractStatus =
  | "draft"
  | "sent"
  | "viewed"
  | "signed"
  | "completed"
  | "cancelled"
  | "expired";

export interface ContractRow {
  id: string;
  title: string;
  status: ContractStatus;
  createdAt: string; // ISO string — serialised from server
}

type Filter = "all" | ContractStatus;

const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "draft", label: "Draft" },
  { key: "sent", label: "Sent" },
  { key: "viewed", label: "Viewed" },
  { key: "signed", label: "Signed" },
  { key: "completed", label: "Completed" },
  { key: "cancelled", label: "Cancelled" },
];

const CANCELLABLE: ReadonlySet<ContractStatus> = new Set<ContractStatus>([
  "draft",
  "sent",
  "viewed",
]);

const dateFmt = new Intl.DateTimeFormat(undefined, {
  year: "numeric",
  month: "short",
  day: "2-digit",
});

function StatusBadge({ status }: { status: ContractStatus }) {
  switch (status) {
    case "draft":
      return <Badge variant="neutral" dot>Draft</Badge>;
    case "sent":
      return <Badge variant="accent" dot>Sent</Badge>;
    case "viewed":
      return <Badge variant="active" dot>Viewed</Badge>;
    case "signed":
      return <Badge variant="active" dot>Signed</Badge>;
    case "completed":
      return (
        <Badge variant="active" dot>
          <span aria-hidden>{"\u2713"}</span>
          Completed
        </Badge>
      );
    case "cancelled":
      return <Badge variant="neutral">Cancelled</Badge>;
    case "expired":
      return <Badge variant="danger" dot>Expired</Badge>;
  }
}

export function ContractsList({ contracts }: { contracts: ContractRow[] }) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");

  const filtered = useMemo(() => {
    if (filter === "all") return contracts;
    return contracts.filter((c) => c.status === filter);
  }, [contracts, filter]);

  function handleCancel(id: string, title: string) {
    const ok = window.confirm(
      `Cancel "${title}"? This stops any in-flight signatures and can't be undone.`,
    );
    if (!ok) return;
    setPendingId(id);
    startTransition(async () => {
      const res = await cancelContract({ contractId: id });
      setPendingId(null);
      if (!res.ok) {
        toast(res.error, "error");
        return;
      }
      toast("Contract cancelled.", "success");
      router.refresh();
    });
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6 sm:py-14">
      <header className="flex flex-wrap items-end justify-between gap-4 reveal-up">
        <div>
          <p className="font-mono text-[0.72rem] uppercase tracking-[0.18em] text-[rgb(var(--fg-muted))]">
            Contracts
          </p>
          <h1
            className="mt-2 font-display text-4xl leading-tight tracking-tight sm:text-5xl"
            style={{ fontWeight: 800 }}
          >
            The paperwork.
          </h1>
          <p className="mt-3 max-w-xl text-sm text-[rgb(var(--fg-secondary))]">
            Upload a PDF, drop signature and initial fields, send it out. The
            signer gets a one-click link — you get a timestamped audit trail.
          </p>
        </div>
        <Button asChild>
          <Link href="/dashboard/contracts/new">New contract</Link>
        </Button>
      </header>

      {contracts.length === 0 ? (
        <section className="mt-10">
          <EmptyState
            title="No contracts yet."
            description="Upload a PDF, drop your signature fields, and send it to a client. They sign in the browser — no account required."
            action={
              <Button asChild>
                <Link href="/dashboard/contracts/new">Send your first contract</Link>
              </Button>
            }
          />
        </section>
      ) : (
        <>
          <nav
            aria-label="Filter contracts by status"
            className="mt-8 flex flex-wrap gap-1.5"
          >
            {FILTERS.map((f) => {
              const active = filter === f.key;
              const count =
                f.key === "all"
                  ? contracts.length
                  : contracts.filter((c) => c.status === f.key).length;
              return (
                <button
                  key={f.key}
                  type="button"
                  onClick={() => { setFilter(f.key); }}
                  aria-pressed={active}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs transition-colors",
                    "border",
                    active
                      ? "border-[rgb(var(--brand-primary)/0.5)] bg-[rgb(var(--brand-primary)/0.12)] text-[rgb(var(--brand-primary))]"
                      : "border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] text-[rgb(var(--fg-secondary))] hover:border-[rgb(var(--border-strong))] hover:text-[rgb(var(--fg-primary))]",
                  )}
                >
                  <span>{f.label}</span>
                  <span className="font-mono text-[0.65rem] text-[rgb(var(--fg-muted))] tabular-nums">
                    {count}
                  </span>
                </button>
              );
            })}
          </nav>

          <section className="mt-6 overflow-hidden rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))]">
            {filtered.length === 0 ? (
              <div className="px-5 py-10 text-center text-sm text-[rgb(var(--fg-secondary))]">
                No contracts match this filter.
              </div>
            ) : (
              <ul role="list" className="divide-y divide-[rgb(var(--border-subtle))]">
                {filtered.map((c) => {
                  const isDraft = c.status === "draft";
                  const canCancel = CANCELLABLE.has(c.status);
                  const createdAt = new Date(c.createdAt);
                  return (
                    <li
                      key={c.id}
                      className={cn(
                        "flex min-h-[44px] flex-wrap items-center gap-3 px-4 py-2.5 transition-colors",
                        "hover:bg-[rgb(var(--bg-elevated))]",
                        c.status === "cancelled" &&
                          "text-[rgb(var(--fg-muted))] line-through decoration-[rgb(var(--fg-muted))]",
                      )}
                    >
                      <div className="flex shrink-0 items-center">
                        <StatusBadge status={c.status} />
                      </div>
                      <Link
                        href={`/dashboard/contracts/${c.id}`}
                        className="min-w-0 flex-1 truncate text-sm font-medium text-[rgb(var(--fg-primary))] hover:text-[rgb(var(--brand-primary))]"
                      >
                        {c.title}
                      </Link>
                      <time
                        dateTime={c.createdAt}
                        className="shrink-0 font-mono text-xs text-[rgb(var(--fg-muted))] tabular-nums"
                      >
                        {dateFmt.format(createdAt)}
                      </time>
                      <div className="flex shrink-0 items-center gap-2">
                        <Link
                          href={`/dashboard/contracts/${c.id}`}
                          className="rounded-[var(--radius-sm)] px-2 py-1 text-xs text-[rgb(var(--fg-secondary))] hover:bg-[rgb(var(--bg-overlay))] hover:text-[rgb(var(--fg-primary))]"
                        >
                          {isDraft ? "Edit" : "View"}
                        </Link>
                        {canCancel ? (
                          <button
                            type="button"
                            onClick={() => { handleCancel(c.id, c.title); }}
                            disabled={pending && pendingId === c.id}
                            className={cn(
                              "rounded-[var(--radius-sm)] px-2 py-1 text-xs",
                              "text-[rgb(var(--fg-danger))] hover:bg-[rgb(var(--fg-danger)/0.08)]",
                              "disabled:pointer-events-none disabled:opacity-40",
                            )}
                          >
                            {pending && pendingId === c.id ? "Cancelling…" : "Cancel"}
                          </button>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}
