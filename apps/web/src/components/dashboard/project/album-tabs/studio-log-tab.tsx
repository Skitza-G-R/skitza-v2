import { MessageSquare, Mic2, Sparkles, Upload } from "lucide-react";

export type StudioLogBookingStatus =
  | "pending_approval"
  | "confirmed"
  | "rejected"
  | "cancelled"
  | "completed"
  | "no_show";

export interface StudioLogActivityEntry {
  id: string;
  kind: "created" | "version" | "comment";
  ts: Date;
  description: string;
}

export interface StudioLogSessionEntry {
  id: string;
  kind: "session";
  ts: Date;
  durationMinutes: number;
  attendees: string[];
  status: StudioLogBookingStatus;
  notes?: string;
}

export type StudioLogEntry = StudioLogActivityEntry | StudioLogSessionEntry;

interface StudioLogTabProps {
  entries: readonly StudioLogEntry[];
}

export function sortStudioLogEntries(entries: readonly StudioLogEntry[]): StudioLogEntry[] {
  return [...entries].sort(
    (left, right) => right.ts.getTime() - left.ts.getTime() || left.id.localeCompare(right.id),
  );
}

function formatDateTime(date: Date): string {
  try {
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(date);
  } catch {
    return date.toISOString();
  }
}

function formatDuration(minutes: number): string {
  if (minutes < 60) return `${String(minutes)} min`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder === 0 ? `${String(hours)}h` : `${String(hours)}h ${String(remainder)}m`;
}

function sessionStatusLabel(status: StudioLogBookingStatus): string {
  if (status === "pending_approval") return "Pending approval";
  if (status === "no_show") return "No-show";
  if (status === "cancelled") return "Canceled";
  return `${status.slice(0, 1).toUpperCase()}${status.slice(1)}`;
}

function ActivityIcon({ kind }: { kind: StudioLogActivityEntry["kind"] }) {
  if (kind === "version") return <Upload size={15} strokeWidth={2.2} aria-hidden />;
  if (kind === "comment") {
    return <MessageSquare size={15} strokeWidth={2.2} aria-hidden />;
  }
  return <Sparkles size={15} strokeWidth={2.2} aria-hidden />;
}

export function StudioLogTab({ entries }: StudioLogTabProps) {
  const ordered = sortStudioLogEntries(entries);

  return (
    <section role="tabpanel" id="panel-log" aria-labelledby="tab-log" className="space-y-3">
      <div>
        <h2 className="font-display text-[18px] font-extrabold tracking-[-0.02em] text-[rgb(var(--fg-default))]">
          Studio Log
        </h2>
        <p className="mt-1 text-[12px] text-[rgb(var(--fg-muted))]">
          Sessions and project activity, newest first.
        </p>
      </div>

      {ordered.length === 0 ? (
        <p className="rounded-[var(--radius-lg)] border border-dashed border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-4 py-8 text-center text-[13px] text-[rgb(var(--fg-muted))]">
          No studio activity yet.
        </p>
      ) : (
        <ol className="relative space-y-2 before:absolute before:top-6 before:bottom-6 before:left-[21px] before:w-px before:bg-[rgb(var(--border-subtle))]">
          {ordered.map((entry) => {
            const session = entry.kind === "session";
            return (
              <li
                key={entry.id}
                className="relative flex min-w-0 items-start gap-3 rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-3 py-3 sm:px-4"
              >
                <span
                  aria-hidden
                  className="relative z-[1] inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-background))] text-[rgb(var(--brand-primary-dark))]"
                >
                  {session ? (
                    <Mic2 size={15} strokeWidth={2.2} />
                  ) : (
                    <ActivityIcon kind={entry.kind} />
                  )}
                </span>

                <span className="min-w-0 flex-1">
                  <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="min-w-0 text-[13px] font-bold text-[rgb(var(--fg-default))]">
                      {session ? "Studio session" : entry.description}
                    </span>
                    {session ? (
                      <span className="rounded-[var(--radius-lg)] bg-[rgb(var(--fg-default)/0.055)] px-2 py-0.5 text-[10px] font-bold text-[rgb(var(--fg-muted))]">
                        {sessionStatusLabel(entry.status)}
                      </span>
                    ) : null}
                  </span>

                  {session ? (
                    <span className="mt-1 block text-[11.5px] text-[rgb(var(--fg-muted))]">
                      {formatDuration(entry.durationMinutes)}
                      {entry.attendees.length > 0 ? ` · ${entry.attendees.join(", ")}` : ""}
                      {entry.notes ? ` · ${entry.notes}` : ""}
                    </span>
                  ) : null}
                </span>

                <time
                  dateTime={entry.ts.toISOString()}
                  className="shrink-0 font-mono text-[10.5px] text-[rgb(var(--fg-muted))]"
                >
                  {formatDateTime(entry.ts)}
                </time>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
