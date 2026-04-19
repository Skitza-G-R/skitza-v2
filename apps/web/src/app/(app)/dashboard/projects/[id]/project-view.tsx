"use client";

// TRANSITIONAL: this component is no longer rendered by page.tsx. It
// remains on disk as a salvage source for Task 9, which will lift the
// remaining Overview + Activity inner tabs out to the outer Notes
// sub-tab. Task 6 extracted Audio → MusicSubTab. Task 8 extracted
// Contract + Invoices → MoneySubTab. Delete this file entirely once
// Task 9 lands the Notes extraction.

import { useRouter, useSearchParams } from "next/navigation";
import { useMemo } from "react";

import { Badge } from "~/components/ui/badge";
import { EmptyState } from "~/components/ui/empty-state";
import { type Stage } from "~/lib/projects/stages";

interface Project {
  id: string;
  title: string;
  stage: Stage;
  artistName: string;
  artistEmail: string;
  clientName: string | null;
  clientEmail: string | null;
  depositPaid: boolean;
  finalPaid: boolean;
  // Task 7 — payment-plan state. When paymentPlanKind === 'split_50_50'
  // and chargesCompleted === 1, the "Mark final delivered" button fires
  // an off-session PaymentIntent via project.chargeFinal before running
  // the existing mark-final side effects. Null-safe for legacy rows.
  paymentPlanKind: string | null;
  // Task 8 — monthly plan installment count + next scheduled charge
  // from the Stripe subscription schedule, both surfaced in the
  // <PaymentStatusStrip/> at the top of the project room.
  installments: number | null;
  nextChargeAt: Date | null;
  chargesCompleted: number;
  chargesTotal: number | null;
  totalAmountCents: number | null;
  cardLast4: string | null;
  currency: string;
  createdAt: Date;
  updatedAt: Date;
}

interface Track {
  id: string;
  title: string;
  artist: string | null;
  position: number;
}

interface Version {
  id: string;
  trackId: string;
  label: string;
  audioUrl: string | null;
  uploadedAt: Date;
  approvedAt: Date | null;
}

interface CommentRow {
  id: string;
  versionId: string;
  authorName: string;
  body: string;
  timestampMs: number;
  resolvedAt: Date | null;
  fromProducer: boolean;
  createdAt: Date;
}

type TabId = "overview" | "activity";
const TABS: { id: TabId; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "activity", label: "Activity" },
];

function isTabId(v: string | null): v is TabId {
  return v === "overview" || v === "activity";
}

function formatMs(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const ss = s % 60;
  return `${String(m)}:${String(ss).padStart(2, "0")}`;
}

function fmtDateTime(d: Date): string {
  return new Date(d).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

// ─── Main ────────────────────────────────────────────────────────────
export function ProjectView({
  project,
  tracks,
  versions,
  comments,
  contractCount,
}: {
  project: Project;
  tracks: Track[];
  versions: Version[];
  comments: CommentRow[];
  contractCount: number;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const tabParam = searchParams.get("tab");
  const activeTab: TabId = isTabId(tabParam) ? tabParam : "overview";

  function switchTab(id: TabId) {
    const params = new URLSearchParams(searchParams.toString());
    if (id === "overview") params.delete("tab");
    else params.set("tab", id);
    const qs = params.toString();
    router.replace(`/dashboard/projects/${project.id}${qs ? `?${qs}` : ""}`, { scroll: false });
  }

  return (
    // Task 5: the outer page now owns the project header + 5-step
    // timeline + 4 sub-tabs. This view renders inside the "music"
    // sub-tab, so the top-level padding/container is a tighter
    // wrapper without the old max-w-5xl shell.
    <div className="flex flex-col gap-6">
      {/* Legacy tab bar. Task 6 removed Audio (→ MusicSubTab). Task 8
          removed Contract + Invoices (→ MoneySubTab). Only Overview +
          Activity remain here; Task 9 will lift them to the outer Notes
          sub-tab and delete this file entirely. */}
      <nav
        aria-label="Project sections"
        role="tablist"
        className="-mx-4 overflow-x-auto border-b border-[rgb(var(--border-subtle))] sm:mx-0"
      >
        <div className="flex min-w-max gap-1 px-4 sm:px-0">
          {TABS.map((t) => {
            const isActive = activeTab === t.id;
            return (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={isActive}
                aria-controls={`panel-${t.id}`}
                id={`tab-${t.id}`}
                onClick={() => {
                  switchTab(t.id);
                }}
                className={[
                  "-mb-px whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-medium transition-colors",
                  isActive
                    ? "border-[rgb(var(--brand-primary))] text-[rgb(var(--fg-primary))]"
                    : "border-transparent text-[rgb(var(--fg-secondary))] hover:text-[rgb(var(--fg-primary))]",
                ].join(" ")}
              >
                {t.label}
              </button>
            );
          })}
        </div>
      </nav>

      <div className="mt-6">
        {activeTab === "overview" ? (
          <OverviewTab
            project={project}
            trackCount={tracks.length}
            versionCount={versions.length}
            contractCount={contractCount}
          />
        ) : null}
        {activeTab === "activity" ? (
          <ActivityTab tracks={tracks} versions={versions} comments={comments} />
        ) : null}
      </div>
    </div>
  );
}

// ─── Overview tab ────────────────────────────────────────────────────
function OverviewTab({
  project,
  trackCount,
  versionCount,
  contractCount,
}: {
  project: Project;
  trackCount: number;
  versionCount: number;
  contractCount: number;
}) {
  // Task 5 — stage dropdown, cancel-project modal, mark-final flow and
  // the confirm-charge modal all moved to the new ProjectHeader (see
  // apps/web/src/components/dashboard/project/project-header.tsx).
  // OverviewTab is now a read-only summary + client details card; the
  // deposit/final pay state reads off the project props for display
  // only. The editable mark-final action now lives in the header's
  // 3-dot menu (which also owns the ConfirmChargeModal wiring for
  // split_50_50 projects).

  return (
    <section
      role="tabpanel"
      id="panel-overview"
      aria-labelledby="tab-overview"
      className="space-y-6"
    >
      <div className="grid gap-4 sm:grid-cols-3">
        <StatBlock label="Tracks" value={String(trackCount)} />
        <StatBlock label="Versions" value={String(versionCount)} />
        <StatBlock label="Contracts" value={String(contractCount)} />
      </div>

      <div className="rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-5">
        <p className="font-mono text-[0.66rem] uppercase tracking-wider text-[rgb(var(--fg-muted))]">
          Client
        </p>
        <dl className="mt-3 grid gap-3 sm:grid-cols-2">
          <div>
            <dt className="text-xs text-[rgb(var(--fg-muted))]">Name</dt>
            <dd className="mt-0.5 text-sm text-[rgb(var(--fg-primary))]">
              {project.clientName ?? project.artistName}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-[rgb(var(--fg-muted))]">Email</dt>
            <dd className="mt-0.5 font-mono text-xs text-[rgb(var(--fg-primary))]">
              {project.clientEmail ?? project.artistEmail}
            </dd>
          </div>
          {project.clientName && project.clientName !== project.artistName ? (
            <>
              <div>
                <dt className="text-xs text-[rgb(var(--fg-muted))]">Artist (credited)</dt>
                <dd className="mt-0.5 text-sm text-[rgb(var(--fg-primary))]">
                  {project.artistName}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-[rgb(var(--fg-muted))]">Artist email</dt>
                <dd className="mt-0.5 font-mono text-xs text-[rgb(var(--fg-primary))]">
                  {project.artistEmail}
                </dd>
              </div>
            </>
          ) : null}
        </dl>
      </div>

      <div className="rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-5">
        <p className="font-mono text-[0.66rem] uppercase tracking-wider text-[rgb(var(--fg-muted))]">
          Timeline
        </p>
        <dl className="mt-3 grid gap-3 sm:grid-cols-2 font-mono text-xs">
          <div>
            <dt className="text-[rgb(var(--fg-muted))]">Created</dt>
            <dd className="mt-0.5 text-[rgb(var(--fg-primary))]">{fmtDateTime(project.createdAt)}</dd>
          </div>
          <div>
            <dt className="text-[rgb(var(--fg-muted))]">Last activity</dt>
            <dd className="mt-0.5 text-[rgb(var(--fg-primary))]">{fmtDateTime(project.updatedAt)}</dd>
          </div>
        </dl>
      </div>
    </section>
  );
}

function StatBlock({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-4">
      <p className="font-mono text-[0.66rem] uppercase tracking-wider text-[rgb(var(--fg-muted))]">
        {label}
      </p>
      <p
        className="mt-1 font-display text-3xl tracking-tight text-[rgb(var(--fg-primary))]"
        style={{ fontWeight: 800 }}
      >
        {value}
      </p>
    </div>
  );
}

// ─── Activity tab ────────────────────────────────────────────────────
type ActivityItem =
  | { kind: "version"; at: Date; trackTitle: string; label: string }
  | { kind: "comment"; at: Date; authorName: string; fromProducer: boolean; body: string; timestampMs: number };

function ActivityTab({
  tracks,
  versions,
  comments,
}: {
  tracks: Track[];
  versions: Version[];
  comments: CommentRow[];
}) {
  const trackById = useMemo(() => {
    const m = new Map<string, Track>();
    for (const t of tracks) m.set(t.id, t);
    return m;
  }, [tracks]);

  const items: ActivityItem[] = useMemo(() => {
    const out: ActivityItem[] = [];
    for (const v of versions) {
      out.push({
        kind: "version",
        at: v.uploadedAt,
        trackTitle: trackById.get(v.trackId)?.title ?? "(unknown track)",
        label: v.label,
      });
    }
    for (const c of comments) {
      out.push({
        kind: "comment",
        at: c.createdAt,
        authorName: c.authorName,
        fromProducer: c.fromProducer,
        body: c.body,
        timestampMs: c.timestampMs,
      });
    }
    out.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
    return out;
  }, [versions, comments, trackById]);

  return (
    <section
      role="tabpanel"
      id="panel-activity"
      aria-labelledby="tab-activity"
      className="space-y-3"
    >
      {items.length === 0 ? (
        <EmptyState
          title="Nothing happened yet."
          description="Upload a track version or receive a comment from the artist — it'll show up here with a timestamp."
        />
      ) : (
        <ol className="space-y-2">
          {items.map((it, i) => (
            <li
              key={`${String(it.at.valueOf())}-${String(i)}`}
              className="rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-4 py-3"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  {it.kind === "version" ? (
                    <p className="text-sm text-[rgb(var(--fg-primary))]">
                      <span className="font-semibold">New version</span>{" "}
                      <span className="font-mono text-xs text-[rgb(var(--brand-primary))]">
                        {it.label}
                      </span>{" "}
                      on{" "}
                      <span className="text-[rgb(var(--fg-secondary))]">{it.trackTitle}</span>
                    </p>
                  ) : (
                    <>
                      <p className="text-sm text-[rgb(var(--fg-primary))]">
                        <span className="font-semibold">{it.authorName}</span>
                        {it.fromProducer ? (
                          <Badge variant="accent" className="ml-2">
                            You
                          </Badge>
                        ) : null}
                        <span className="ml-1 text-[rgb(var(--fg-secondary))]">
                          commented at{" "}
                          <span className="font-mono text-xs text-[rgb(var(--brand-primary))]">
                            {formatMs(it.timestampMs)}
                          </span>
                        </span>
                      </p>
                      <p className="mt-1 text-sm text-[rgb(var(--fg-secondary))]">{it.body}</p>
                    </>
                  )}
                </div>
                <p className="whitespace-nowrap font-mono text-[0.66rem] text-[rgb(var(--fg-muted))]">
                  {fmtDateTime(it.at)}
                </p>
              </div>
            </li>
          ))}
        </ol>
      )}
      <p className="mt-4 font-mono text-[0.66rem] text-[rgb(var(--fg-muted))]">
        TODO: contract send/view/sign events land here once the project_events table is wired.
      </p>
    </section>
  );
}
