import { Mic, Users } from "lucide-react";

import { StatTile } from "~/components/dashboard/common/stat-tile";

// StudioLogTab — Studio Log panel for the new Album Page (DESIGN.md
// §4.3, BUILD-NOTES §5.3). 4 insight tiles up top + a vertical
// activity timeline + a sessions list. Album-only — Phase 3 Song Space
// does NOT have a Studio Log tab.
//
// We don't reuse the legacy SessionsSubTab here for two reasons:
//  1) That component is shaped around a single 1:1 booking (its v1
//     constraint). The new Album Page needs an N-session list.
//  2) The legacy component bakes "Reschedule / Cancel" stubs that
//     don't belong on the album view.
// Inline rendering keeps this panel decoupled from the legacy data
// shape so Phase 4+ can swap in real session-list data without
// touching that file.

export interface StudioLogActivity {
  id: string;
  kind: string;
  ts: Date;
  description: string;
}

export interface StudioLogSession {
  id: string;
  date: Date;
  durationMinutes: number;
  attendees: string[];
  notes?: string;
}

export interface StudioLogTabProps {
  sessionsCount: number;
  studioHours: number;
  thisMonthCount: number;
  lastSessionDate: Date | null;
  activities: StudioLogActivity[];
  sessions: StudioLogSession[];
}

function formatDate(d: Date | null): string {
  if (!d) return "—";
  try {
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
    }).format(d);
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

function formatDateTime(d: Date): string {
  try {
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(d);
  } catch {
    return d.toISOString();
  }
}

function formatDuration(min: number): string {
  if (min < 60) return `${String(min)} min`;
  const h = Math.floor(min / 60);
  const r = min % 60;
  if (r === 0) return `${String(h)}h`;
  return `${String(h)}h ${String(r)}m`;
}

export function StudioLogTab({
  sessionsCount,
  studioHours,
  thisMonthCount,
  lastSessionDate,
  activities,
  sessions,
}: StudioLogTabProps) {
  return (
    <section
      role="tabpanel"
      id="panel-log"
      aria-labelledby="tab-log"
      className="space-y-6"
    >
      {/* 4 insight tiles */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatTile label="Sessions logged" value={sessionsCount} />
        <StatTile
          label="Studio hours"
          value={<span className="tabular-nums">{studioHours.toFixed(1)}</span>}
        />
        <StatTile label="This month" value={thisMonthCount} />
        <StatTile
          label="Last session"
          value={formatDate(lastSessionDate)}
        />
      </div>

      {/* Activity timeline */}
      <div>
        <h3
          className="font-syne text-[18px] font-bold"
          style={{ color: "rgb(var(--fg-default))" }}
        >
          Activity
        </h3>
        {activities.length === 0 ? (
          <p
            className="mt-3 rounded-[var(--radius-md)] border border-dashed px-4 py-6 text-[13px]"
            style={{
              borderColor: "rgb(var(--border-subtle))",
              color: "rgb(var(--fg-muted))",
            }}
          >
            No activity yet — uploads, comments, and stage changes show up here.
          </p>
        ) : (
          <ol className="mt-3 space-y-2">
            {activities.map((a) => (
              <li
                key={a.id}
                className="flex items-start gap-3 rounded-[var(--radius-md)] border px-4 py-3"
                style={{
                  background: "rgb(var(--bg-elevated))",
                  borderColor: "rgb(var(--border-subtle))",
                }}
              >
                <span
                  aria-hidden
                  className="mt-1 inline-block h-2 w-2 shrink-0 rounded-full"
                  style={{ background: "rgb(var(--brand-primary))" }}
                />
                <div className="min-w-0 flex-1">
                  <p
                    className="text-[13px] font-medium"
                    style={{ color: "rgb(var(--fg-default))" }}
                  >
                    {a.description}
                  </p>
                </div>
                <span
                  className="whitespace-nowrap font-mono text-[11px]"
                  style={{ color: "rgb(var(--fg-muted))" }}
                >
                  {formatDateTime(a.ts)}
                </span>
              </li>
            ))}
          </ol>
        )}
      </div>

      {/* Sessions list */}
      <div>
        <h3
          className="font-syne text-[18px] font-bold"
          style={{ color: "rgb(var(--fg-default))" }}
        >
          Sessions
        </h3>
        {sessions.length === 0 ? (
          <p
            className="mt-3 rounded-[var(--radius-md)] border border-dashed px-4 py-6 text-[13px]"
            style={{
              borderColor: "rgb(var(--border-subtle))",
              color: "rgb(var(--fg-muted))",
            }}
          >
            No sessions on the books yet — sessions you book against this project show up here.
          </p>
        ) : (
          <ol className="mt-3 space-y-2">
            {sessions.map((s) => (
              <li
                key={s.id}
                className="flex items-center gap-3 rounded-[var(--radius-md)] border px-4 py-3"
                style={{
                  background: "rgb(var(--bg-elevated))",
                  borderColor: "rgb(var(--border-subtle))",
                }}
              >
                <span
                  aria-hidden
                  className="inline-flex h-8 w-8 items-center justify-center rounded-[var(--radius-sm)]"
                  style={{
                    background: "rgb(var(--brand-primary) / 0.12)",
                    color: "rgb(var(--brand-primary))",
                  }}
                >
                  <Mic size={14} />
                </span>
                <div className="min-w-0 flex-1">
                  <p
                    className="text-[13px] font-medium"
                    style={{ color: "rgb(var(--fg-default))" }}
                  >
                    {formatDateTime(s.date)}
                  </p>
                  {s.attendees.length > 0 ? (
                    <p
                      className="mt-0.5 inline-flex items-center gap-1 text-[11px]"
                      style={{ color: "rgb(var(--fg-muted))" }}
                    >
                      <Users size={10} />
                      {s.attendees.join(", ")}
                    </p>
                  ) : null}
                </div>
                <span
                  className="whitespace-nowrap font-mono text-[12px] tabular-nums"
                  style={{ color: "rgb(var(--fg-muted))" }}
                >
                  {formatDuration(s.durationMinutes)}
                </span>
              </li>
            ))}
          </ol>
        )}
      </div>
    </section>
  );
}
