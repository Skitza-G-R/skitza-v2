"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type SyntheticEvent,
} from "react";

import {
  PLAYER_EVENTS,
  playerPlay,
  type PlayerTrack,
} from "~/components/audio/persistent-player";
import { Button } from "~/components/ui/button";
import { EmptyState } from "~/components/ui/empty-state";
import { useToast } from "~/components/ui/toast";

import {
  addLibraryComment,
  fetchVersionDetail,
  resolveLibraryComment,
} from "./actions";

// Samply-style unified audio library. Two-pane layout on desktop:
// track list on the left, selected-version side panel on the right
// with the comment feed + new-comment form. On mobile the side panel
// collapses into a full-screen modal so one hand works for both
// scanning and commenting.
//
// The persistent player (mounted in AppShell) is the single source of
// truth for audio playback. Clicking a row's play button dispatches a
// `skitza:player:set` event; clicking a comment timestamp dispatches
// `skitza:player:seek`. The side-panel "now at" ticker listens for
// `skitza:player:time` broadcasts so it stays in sync without owning
// any audio element of its own.
//
// We reserve `pb-28` at the root so the fixed-bottom player never
// covers the last row — matches the 64px bar + 24px comfort margin.

type LibraryRow = {
  versionId: string;
  versionLabel: string;
  audioUrl: string | null;
  uploadedAt: Date | string;
  durationMs: number | null;
  trackId: string;
  trackTitle: string;
  projectId: string;
  projectTitle: string;
  projectArtistName: string;
  projectClientName: string | null;
  commentCount: number;
  unresolvedCount: number;
};

type FilterId = "all" | "unread" | "resolved";

type CommentRow = {
  id: string;
  versionId: string;
  authorName: string;
  body: string;
  timestampMs: number;
  resolvedAt: Date | string | null;
  fromProducer: boolean;
  createdAt: Date | string;
};

type DetailPayload = {
  version: {
    id: string;
    trackId: string;
    label: string;
    audioUrl: string | null;
    durationMs: number | null;
    uploadedAt: Date | string;
  };
  track: { id: string; title: string; projectId: string };
  project: { id: string; title: string; artistName: string };
  comments: CommentRow[];
};

const relFmt = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
const dateFmt = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });

function toDate(v: Date | string | null | undefined): Date | null {
  if (!v) return null;
  return v instanceof Date ? v : new Date(v);
}

function formatRelative(v: Date | string | null | undefined): string {
  const d = toDate(v);
  if (!d) return "—";
  const diff = d.getTime() - Date.now();
  const abs = Math.abs(diff);
  const min = 60_000;
  const hr = 3_600_000;
  const day = 86_400_000;
  if (abs < min) return "just now";
  if (abs < hr) return relFmt.format(Math.round(diff / min), "minute");
  if (abs < day) return relFmt.format(Math.round(diff / hr), "hour");
  if (abs < 30 * day) return relFmt.format(Math.round(diff / day), "day");
  return dateFmt.format(d);
}

function fmtTimestamp(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "0:00";
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${String(m)}:${String(s).padStart(2, "0")}`;
}

export function LibraryList({ initial }: { initial: LibraryRow[] }) {
  const searchParams = useSearchParams();
  const [filter, setFilter] = useState<FilterId>("all");
  const [selected, setSelected] = useState<string | null>(null);
  const [mobilePanelOpen, setMobilePanelOpen] = useState(false);

  // Deep-link: ?v=<versionId> opens the side panel for that version
  // on mount. Used by the ⌘K palette "Tracks" results.
  useEffect(() => {
    const v = searchParams.get("v");
    if (v) {
      setSelected(v);
      // On mobile we can't guarantee the viewport width at render time,
      // so unconditionally open the modal — desktop ignores this state.
      setMobilePanelOpen(true);
    }
  }, [searchParams]);

  const counts = useMemo(() => {
    let unread = 0;
    let resolved = 0;
    for (const r of initial) {
      if (r.unresolvedCount > 0) unread += 1;
      else if (r.commentCount > 0) resolved += 1;
    }
    return { all: initial.length, unread, resolved };
  }, [initial]);

  const rows = useMemo(() => {
    if (filter === "unread") return initial.filter((r) => r.unresolvedCount > 0);
    if (filter === "resolved") {
      return initial.filter(
        (r) => r.commentCount > 0 && r.unresolvedCount === 0,
      );
    }
    return initial;
  }, [initial, filter]);

  const selectedRow = useMemo(
    () => initial.find((r) => r.versionId === selected) ?? null,
    [initial, selected],
  );

  const openRow = useCallback((row: LibraryRow) => {
    setSelected(row.versionId);
    setMobilePanelOpen(true);
  }, []);

  if (initial.length === 0) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-10 pb-28 md:px-6">
        <header className="mb-6">
          <h1 className="font-display text-2xl tracking-tight text-[rgb(var(--fg-primary))]">
            Library
          </h1>
          <p className="mt-1 text-sm text-[rgb(var(--fg-secondary))]">
            Every track across every project, in one place.
          </p>
        </header>
        <EmptyState
          icon={<LibraryIcon />}
          title="Your library is empty."
          description="Every track version across every project lives here. Upload on a project's Audio tab and it'll show up — no manual sync required."
          action={
            <Link
              href="/dashboard"
              className="inline-flex items-center rounded-md bg-[rgb(var(--brand-primary))] px-4 py-2 text-sm font-medium text-[rgb(var(--fg-inverse))] hover:brightness-110"
            >
              Go to Pipeline
            </Link>
          }
          className="min-h-[60vh] justify-center"
        />
      </div>
    );
  }

  return (
    <div className="mx-auto grid max-w-6xl gap-6 px-4 py-6 pb-28 md:grid-cols-[minmax(0,1fr)_380px] md:px-6">
      {/* Left pane — list */}
      <section className="min-w-0">
        <header className="mb-5">
          <h1 className="font-display text-2xl tracking-tight text-[rgb(var(--fg-primary))]">
            Library
          </h1>
          <p className="mt-1 text-sm text-[rgb(var(--fg-secondary))]">
            {initial.length === 1
              ? "1 track version across your projects."
              : `${String(initial.length)} track versions across your projects.`}
          </p>
        </header>

        <div
          role="tablist"
          aria-label="Library filter"
          className="mb-4 flex flex-wrap gap-1.5"
        >
          <FilterChip
            id="all"
            label="All"
            count={counts.all}
            active={filter === "all"}
            onClick={() => {
              setFilter("all");
            }}
          />
          <FilterChip
            id="unread"
            label="Unread"
            count={counts.unread}
            active={filter === "unread"}
            onClick={() => {
              setFilter("unread");
            }}
          />
          <FilterChip
            id="resolved"
            label="Resolved"
            count={counts.resolved}
            active={filter === "resolved"}
            onClick={() => {
              setFilter("resolved");
            }}
          />
        </div>

        {rows.length === 0 ? (
          <EmptyState
            title="Nothing here yet."
            description={
              filter === "unread"
                ? "No tracks with unresolved comments — inbox zero feels good."
                : filter === "resolved"
                  ? "No fully-resolved tracks yet."
                  : "Try uploading a version from any project's Audio tab."
            }
          />
        ) : (
          <ul className="flex flex-col gap-2">
            {rows.map((row) => (
              <LibraryRowCard
                key={row.versionId}
                row={row}
                active={selected === row.versionId}
                onOpen={() => {
                  openRow(row);
                }}
              />
            ))}
          </ul>
        )}
      </section>

      {/* Right pane — desktop side panel */}
      <aside className="hidden md:block">
        <div className="sticky top-4">
          {selectedRow ? (
            <SidePanel key={selectedRow.versionId} row={selectedRow} />
          ) : (
            <div className="rounded-[var(--radius-lg)] border border-dashed border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-sunken))] p-6 text-center text-sm text-[rgb(var(--fg-muted))]">
              Select a track to see the waveform and comments.
            </div>
          )}
        </div>
      </aside>

      {/* Mobile side-panel — full-screen modal */}
      {mobilePanelOpen && selectedRow ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`${selectedRow.trackTitle} details`}
          className="fixed inset-0 z-50 bg-[rgb(var(--bg-base))] md:hidden"
        >
          <div className="flex items-center justify-between border-b border-[rgb(var(--border-subtle))] px-4 py-3">
            <p className="truncate text-sm font-medium text-[rgb(var(--fg-primary))]">
              {selectedRow.trackTitle}
            </p>
            <button
              type="button"
              aria-label="Close"
              onClick={() => {
                setMobilePanelOpen(false);
              }}
              className="-m-2 flex h-11 w-11 items-center justify-center rounded-md text-[rgb(var(--fg-secondary))] hover:bg-[rgb(var(--bg-overlay))]"
            >
              <CloseIcon />
            </button>
          </div>
          <div className="h-[calc(100dvh-57px-80px)] overflow-y-auto p-4">
            <SidePanel key={selectedRow.versionId} row={selectedRow} />
          </div>
        </div>
      ) : null}
    </div>
  );
}

function FilterChip({
  id,
  label,
  count,
  active,
  onClick,
}: {
  id: string;
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      data-filter={id}
      onClick={onClick}
      className={`inline-flex h-11 items-center gap-2 rounded-full border px-4 text-sm transition-colors md:h-9 md:px-3 md:text-[13px] ${
        active
          ? "border-[rgb(var(--brand-primary))] bg-[rgb(var(--brand-primary))] text-[rgb(var(--fg-inverse))]"
          : "border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] text-[rgb(var(--fg-secondary))] hover:text-[rgb(var(--fg-primary))]"
      }`}
    >
      <span>{label}</span>
      <span
        className={`rounded-full px-1.5 font-mono text-[10px] ${
          active
            ? "bg-[rgb(var(--fg-inverse))]/15 text-[rgb(var(--fg-inverse))]"
            : "bg-[rgb(var(--bg-overlay))] text-[rgb(var(--fg-muted))]"
        }`}
      >
        {count}
      </span>
    </button>
  );
}

function LibraryRowCard({
  row,
  active,
  onOpen,
}: {
  row: LibraryRow;
  active: boolean;
  onOpen: () => void;
}) {
  const title = `${row.projectTitle} · ${row.versionLabel}`;
  const subtitle = `${row.projectArtistName} · ${formatRelative(row.uploadedAt)}`;

  const handlePlay = useCallback(
    (e: SyntheticEvent) => {
      e.stopPropagation();
      const track: PlayerTrack = {
        id: row.versionId,
        audioUrl: row.audioUrl,
        title,
        subtitle,
        durationMs: row.durationMs,
      };
      playerPlay(track);
    },
    [row, title, subtitle],
  );

  return (
    <li>
      <div
        className={`group flex items-center gap-3 rounded-[var(--radius-md)] border bg-[rgb(var(--bg-elevated))] p-3 transition-colors ${
          active
            ? "border-[rgb(var(--brand-primary))]/60 ring-1 ring-[rgb(var(--brand-primary))]/30"
            : "border-[rgb(var(--border-subtle))] hover:border-[rgb(var(--border-strong))]"
        }`}
      >
        <button
          type="button"
          aria-label={`Play ${row.trackTitle}`}
          disabled={!row.audioUrl}
          onClick={handlePlay}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[rgb(var(--brand-primary))] text-[rgb(var(--fg-inverse))] shadow-sm transition-[transform,filter] hover:brightness-110 active:translate-y-[1px] disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))] focus-visible:ring-offset-2 focus-visible:ring-offset-[rgb(var(--bg-base))]"
        >
          <PlayIcon />
        </button>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-[rgb(var(--fg-primary))]">
            {title}
          </p>
          <p className="truncate font-mono text-[11px] uppercase tracking-wider text-[rgb(var(--fg-muted))]">
            {subtitle}
          </p>
        </div>
        <div className="hidden items-center gap-2 sm:flex">
          <CommentChip
            commentCount={row.commentCount}
            unresolvedCount={row.unresolvedCount}
          />
        </div>
        <button
          type="button"
          onClick={onOpen}
          className="inline-flex h-11 shrink-0 items-center rounded-md border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-3 text-sm text-[rgb(var(--fg-primary))] transition-colors hover:bg-[rgb(var(--bg-overlay))] md:h-9"
        >
          Open
        </button>
      </div>
    </li>
  );
}

function CommentChip({
  commentCount,
  unresolvedCount,
}: {
  commentCount: number;
  unresolvedCount: number;
}) {
  if (commentCount === 0) {
    return (
      <span className="font-mono text-[10px] uppercase tracking-wider text-[rgb(var(--fg-muted))]">
        No notes
      </span>
    );
  }
  if (unresolvedCount > 0) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-[rgb(var(--brand-primary))]/15 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-[rgb(var(--brand-primary))]">
        <span
          aria-hidden
          className="h-1.5 w-1.5 rounded-full bg-[rgb(var(--brand-primary))]"
        />
        {String(unresolvedCount)} unread
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-[rgb(var(--bg-overlay))] px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-[rgb(var(--fg-secondary))]">
      <CheckIcon />
      Resolved
    </span>
  );
}

function SidePanel({ row }: { row: LibraryRow }) {
  const [detail, setDetail] = useState<DetailPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentMs, setCurrentMs] = useState(0);
  const [body, setBody] = useState("");
  const [submitting, startTransition] = useTransition();
  const { toast } = useToast();
  const lastLoadedVersionRef = useRef<string | null>(null);

  // Subscribe to player broadcasts so "add a comment at 1:23" reads
  // the right timestamp. We ignore broadcasts when a different track
  // is playing — the user wants their comment anchored to the track
  // they're looking at, not whichever one happens to be playing.
  useEffect(() => {
    function onTime(e: Event) {
      const ms = (e as CustomEvent<number>).detail;
      setCurrentMs(ms);
    }
    window.addEventListener(PLAYER_EVENTS.time, onTime as EventListener);
    return () => {
      window.removeEventListener(PLAYER_EVENTS.time, onTime as EventListener);
    };
  }, []);

  // Load detail (comments) when the selected version changes. The
  // abort controller pattern lets us discard a stale response if the
  // user selects a different row before this resolves.
  useEffect(() => {
    if (lastLoadedVersionRef.current === row.versionId) return;
    lastLoadedVersionRef.current = row.versionId;
    const cancel = { value: false };
    setLoading(true);
    setError(null);
    void (async () => {
      const res = await fetchVersionDetail({ versionId: row.versionId });
      if (cancel.value) return;
      if (res.ok) {
        setDetail(res.data);
      } else {
        setError(res.error);
      }
      setLoading(false);
    })();
    return () => {
      cancel.value = true;
    };
  }, [row.versionId]);

  const handlePlayCurrent = useCallback(() => {
    const track: PlayerTrack = {
      id: row.versionId,
      audioUrl: row.audioUrl,
      title: `${row.projectTitle} · ${row.versionLabel}`,
      subtitle: `${row.projectArtistName} · ${formatRelative(row.uploadedAt)}`,
      durationMs: row.durationMs,
    };
    playerPlay(track);
  }, [row]);

  const handleSeek = useCallback((ms: number) => {
    window.dispatchEvent(new CustomEvent(PLAYER_EVENTS.seek, { detail: ms }));
  }, []);

  const submitComment = useCallback(
    (e: SyntheticEvent<HTMLFormElement>) => {
      e.preventDefault();
      const trimmed = body.trim();
      if (!trimmed) return;
      const ts = Math.max(0, Math.floor(currentMs));
      startTransition(async () => {
        const res = await addLibraryComment({
          versionId: row.versionId,
          body: trimmed,
          timestampMs: ts,
        });
        if (res.ok) {
          setDetail((prev) =>
            prev ? { ...prev, comments: [...prev.comments, res.data] } : prev,
          );
          setBody("");
          toast("Comment added", "success");
        } else {
          toast(res.error, "error");
        }
      });
    },
    [body, currentMs, row.versionId, toast],
  );

  const toggleResolved = useCallback(
    (id: string, currentlyResolved: boolean) => {
      startTransition(async () => {
        const res = await resolveLibraryComment({ id, resolved: !currentlyResolved });
        if (res.ok) {
          setDetail((prev) =>
            prev
              ? {
                  ...prev,
                  comments: prev.comments.map((c) =>
                    c.id === id
                      ? {
                          ...c,
                          resolvedAt: currentlyResolved ? null : new Date(),
                        }
                      : c,
                  ),
                }
              : prev,
          );
        } else {
          toast(res.error, "error");
        }
      });
    },
    [toast],
  );

  const comments = detail?.comments ?? [];

  return (
    <div className="flex flex-col gap-4 rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-4">
      <div className="flex items-start gap-3">
        <button
          type="button"
          onClick={handlePlayCurrent}
          aria-label={`Play ${row.trackTitle}`}
          disabled={!row.audioUrl}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[rgb(var(--brand-primary))] text-[rgb(var(--fg-inverse))] hover:brightness-110 disabled:opacity-50"
        >
          <PlayIcon />
        </button>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-[rgb(var(--fg-primary))]">
            {row.trackTitle}
          </p>
          <p className="truncate font-mono text-[11px] uppercase tracking-wider text-[rgb(var(--fg-muted))]">
            {row.versionLabel} · {row.projectArtistName}
          </p>
          <Link
            href={`/dashboard/projects/${row.projectId}`}
            className="mt-1 inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-wider text-[rgb(var(--brand-primary))] hover:underline"
          >
            Open project →
          </Link>
        </div>
      </div>

      <div className="flex items-center justify-between rounded-md bg-[rgb(var(--bg-sunken))] px-3 py-2 font-mono text-[11px] tabular-nums text-[rgb(var(--fg-secondary))]">
        <span>Comments ({String(comments.length)})</span>
        <span>Now: {fmtTimestamp(currentMs)}</span>
      </div>

      {loading ? (
        <p className="py-4 text-center text-xs text-[rgb(var(--fg-muted))]">
          Loading comments…
        </p>
      ) : error ? (
        <p className="py-4 text-center text-xs text-[rgb(var(--fg-danger))]">
          {error}
        </p>
      ) : comments.length === 0 ? (
        <p className="py-4 text-center text-xs text-[rgb(var(--fg-muted))]">
          No comments yet. Add one below to kick off the conversation.
        </p>
      ) : (
        <ul className="flex max-h-[40vh] flex-col gap-2 overflow-y-auto">
          {comments.map((c) => (
            <li
              key={c.id}
              className={`rounded-md border p-3 text-sm ${
                c.resolvedAt
                  ? "border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-sunken))] opacity-70"
                  : "border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-base))]"
              }`}
            >
              <div className="mb-1 flex items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={() => {
                    handleSeek(c.timestampMs);
                  }}
                  className="inline-flex items-center gap-1 font-mono text-[11px] tabular-nums text-[rgb(var(--brand-primary))] hover:underline"
                  aria-label={`Jump to ${fmtTimestamp(c.timestampMs)}`}
                >
                  @ {fmtTimestamp(c.timestampMs)}
                </button>
                <span className="font-mono text-[10px] uppercase tracking-wider text-[rgb(var(--fg-muted))]">
                  {c.fromProducer ? "You" : c.authorName}
                </span>
              </div>
              <p className="whitespace-pre-wrap text-[13px] text-[rgb(var(--fg-primary))]">
                {c.body}
              </p>
              <div className="mt-2 flex items-center justify-between">
                <span className="font-mono text-[10px] text-[rgb(var(--fg-muted))]">
                  {formatRelative(c.createdAt)}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    toggleResolved(c.id, Boolean(c.resolvedAt));
                  }}
                  disabled={submitting}
                  className="font-mono text-[10px] uppercase tracking-wider text-[rgb(var(--fg-secondary))] hover:text-[rgb(var(--fg-primary))] disabled:opacity-50"
                >
                  {c.resolvedAt ? "Reopen" : "Resolve"}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={submitComment} className="flex flex-col gap-2">
        <label htmlFor="comment-body" className="font-mono text-[10px] uppercase tracking-wider text-[rgb(var(--fg-muted))]">
          Add comment at {fmtTimestamp(currentMs)}
        </label>
        <textarea
          id="comment-body"
          value={body}
          onChange={(e) => {
            setBody(e.target.value);
          }}
          placeholder="What do you want to flag?"
          rows={2}
          maxLength={2000}
          className="min-h-[60px] w-full resize-y rounded-md border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-base))] px-3 py-2 text-[16px] text-[rgb(var(--fg-primary))] placeholder:text-[rgb(var(--fg-muted))] focus:border-[rgb(var(--brand-primary))] focus:outline-none md:text-sm"
        />
        <div className="flex items-center justify-end">
          <Button type="submit" disabled={submitting || body.trim().length === 0}>
            {submitting ? "Posting…" : "Post"}
          </Button>
        </div>
      </form>
    </div>
  );
}

function PlayIcon() {
  return (
    <svg viewBox="0 0 12 12" width={14} height={14} fill="currentColor" aria-hidden>
      <path d="M3.5 2.5v7L9.5 6z" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 12 12" width={10} height={10} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M2.5 6.5 5 9l4.5-5" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 16 16" width={18} height={18} fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" aria-hidden>
      <path d="M3.5 3.5 12.5 12.5M12.5 3.5 3.5 12.5" />
    </svg>
  );
}

function LibraryIcon() {
  return (
    <svg
      aria-hidden
      width="20"
      height="20"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 10V6" />
      <path d="M6 12V4" />
      <path d="M9 11V5" />
      <path d="M12 9V7" />
    </svg>
  );
}
