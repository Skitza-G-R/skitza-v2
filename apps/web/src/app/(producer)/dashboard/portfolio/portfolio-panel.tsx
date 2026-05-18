"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type SyntheticEvent,
} from "react";
import { useRouter } from "next/navigation";

import { useToast } from "~/components/ui/toast";

import {
  addExternalLink,
  addPortfolioFromLibrary,
  deletePortfolioTrack,
  removeExternalLink,
  reorderExternalLinks,
  reorderPortfolioTracks,
  type ExternalPlatformValue,
} from "./actions";

// ─── Public types ───────────────────────────────────────────────────

export type PortfolioTrackRow = {
  id: string;
  title: string;
  artist: string | null;
  isPublicSample: boolean;
  audioUrl: string | null;
  durationMs: number | null;
};

export type ExternalLinkRow = {
  id: string;
  platform: ExternalPlatformValue;
  url: string;
};

export type LibraryPickRow = {
  versionId: string;
  trackTitle: string;
  projectTitle: string;
  artistName: string;
  audioUrl: string | null;
  uploadedAt: string;
};

// ─── Caps (one-screen invariant, design doc §0.3) ───────────────────

export const TRACK_CAP = 5;
export const LINK_CAP = 7; // mirrors the seven supported platforms

// ─── Platform display labels ───────────────────────────────────────

export const PLATFORM_LABEL: Record<ExternalPlatformValue, string> = {
  spotify: "Spotify",
  apple_music: "Apple Music",
  youtube: "YouTube",
  soundcloud: "SoundCloud",
  bandcamp: "Bandcamp",
  tidal: "Tidal",
  instagram_reels: "Instagram",
};

// ─── Pure helpers (exported for unit tests) ─────────────────────────

/**
 * Swap an item in `arr` with its adjacent neighbour. Returns `null`
 * when the swap would step out of bounds (i.e. ▲ on first row, ▼ on
 * last row). Pure: does not mutate `arr`.
 */
export function swapAdjacent<T>(
  arr: readonly T[],
  index: number,
  direction: "up" | "down",
): T[] | null {
  const targetIdx = direction === "up" ? index - 1 : index + 1;
  if (index < 0 || index >= arr.length) return null;
  if (targetIdx < 0 || targetIdx >= arr.length) return null;
  const next = arr.slice();
  const a = next[index];
  const b = next[targetIdx];
  if (a === undefined || b === undefined) return null;
  next[index] = b;
  next[targetIdx] = a;
  return next;
}

/**
 * Deterministic decorative waveform bars (0.35 — 1.0 height) seeded
 * from a track id. Used purely as visual ornament until the
 * portfolioTracks → trackVersions.peaks join is plumbed (PR #135 only
 * stores peaks on track_versions; portfolio rows are a denormalised
 * copy and don't carry peaks today).
 */
export function seededBars(id: string, count = 40): number[] {
  let seed = 5381;
  for (let i = 0; i < id.length; i++) {
    seed = ((seed << 5) + seed + id.charCodeAt(i)) >>> 0;
  }
  const bars: number[] = [];
  for (let i = 0; i < count; i++) {
    seed = (seed * 1103515245 + 12345) >>> 0;
    bars.push(0.35 + (seed / 0xffffffff) * 0.65);
  }
  return bars;
}

/** ms → "m:ss" or empty string. */
export function formatDuration(ms: number | null): string {
  if (!ms || ms <= 0) return "";
  const totalSec = Math.round(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m.toString()}:${s.toString().padStart(2, "0")}`;
}

/** True when the row can move in the given direction. */
export function canReorder(
  direction: "up" | "down",
  index: number,
  total: number,
): boolean {
  return direction === "up" ? index > 0 : index < total - 1;
}

// ─── Panel ──────────────────────────────────────────────────────────

export function PortfolioPanel({
  tracks,
  links,
  library,
  addedAudioUrls,
}: {
  tracks: PortfolioTrackRow[];
  links: ExternalLinkRow[];
  library: LibraryPickRow[];
  addedAudioUrls: string[];
}) {
  return (
    <div className="grid grid-cols-[minmax(0,38fr)_minmax(0,62fr)] gap-10">
      <div data-portfolio-col="left">
        <SocialLinksSection initialLinks={links} />
      </div>
      <div data-portfolio-col="right">
        <FeaturedTracksSection
          initialTracks={tracks}
          library={library}
          addedAudioUrls={addedAudioUrls}
        />
      </div>
    </div>
  );
}

// ─── Section: Featured tracks ───────────────────────────────────────

function FeaturedTracksSection({
  initialTracks,
  library,
  addedAudioUrls,
}: {
  initialTracks: PortfolioTrackRow[];
  library: LibraryPickRow[];
  addedAudioUrls: string[];
}) {
  const [rows, setRows] = useState<PortfolioTrackRow[]>(initialTracks);
  const router = useRouter();
  const { toast } = useToast();
  const [, startTransition] = useTransition();

  useEffect(() => {
    setRows(initialTracks);
  }, [initialTracks]);

  const atCap = rows.length >= TRACK_CAP;

  function reorder(index: number, direction: "up" | "down") {
    const next = swapAdjacent(rows, index, direction);
    if (!next) return;
    const orderedIds = next.map((r) => r.id);
    setRows(next);
    startTransition(async () => {
      const res = await reorderPortfolioTracks({ orderedIds });
      if (!res.ok) {
        toast(res.error, "error");
        setRows(initialTracks);
        return;
      }
      router.refresh();
    });
  }

  function remove(id: string) {
    setRows((all) => all.filter((r) => r.id !== id));
    startTransition(async () => {
      const res = await deletePortfolioTrack({ id });
      if (!res.ok) {
        toast(res.error, "error");
        setRows(initialTracks);
        return;
      }
      router.refresh();
    });
  }

  return (
    <section
      aria-labelledby="portfolio-tracks-heading"
      className="sk-portfolio-section"
    >
      <header className="mb-4 flex items-end justify-between gap-3">
        <div>
          <h2
            id="portfolio-tracks-heading"
            className="font-display text-2xl tracking-tight text-[rgb(var(--fg-primary))]"
            style={{ fontWeight: 700 }}
          >
            Featured tracks
          </h2>
          <p className="mt-1 font-mono text-[10.5px] uppercase tracking-[0.16em] text-[rgb(var(--fg-muted))]">
            PICK YOUR BEST. ARROWS REORDER.
          </p>
        </div>
        <AddFromLibraryButton
          library={library}
          addedAudioUrls={addedAudioUrls}
          disabled={atCap}
        />
      </header>

      {atCap ? (
        <p
          aria-live="polite"
          className="mb-3 font-mono text-[10.5px] uppercase tracking-[0.14em] text-[rgb(var(--fg-muted))]"
        >
          LIMIT REACHED ({TRACK_CAP}/{TRACK_CAP})
        </p>
      ) : null}

      {rows.length === 0 ? (
        <FeaturedTracksEmpty
          library={library}
          addedAudioUrls={addedAudioUrls}
        />
      ) : (
        <ul className="space-y-3">
          {rows.map((row, idx) => (
            <TrackRow
              key={row.id}
              row={row}
              index={idx}
              total={rows.length}
              onReorder={(dir) => {
                reorder(idx, dir);
              }}
              onRemove={() => {
                remove(row.id);
              }}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function FeaturedTracksEmpty({
  library,
  addedAudioUrls,
}: {
  library: LibraryPickRow[];
  addedAudioUrls: string[];
}) {
  return (
    <div
      role="status"
      className="flex flex-col items-center justify-center gap-3 rounded-[var(--radius-lg)] border border-dashed border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-sunken))] px-6 py-12 text-center"
    >
      <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-[rgb(var(--fg-muted))]">
        NO FEATURED TRACKS YET. ADD ONE FROM YOUR MUSIC LIBRARY.
      </p>
      <AddFromLibraryButton
        library={library}
        addedAudioUrls={addedAudioUrls}
        disabled={false}
        ghost
      />
    </div>
  );
}

function TrackRow({
  row,
  index,
  total,
  onReorder,
  onRemove,
}: {
  row: PortfolioTrackRow;
  index: number;
  total: number;
  onReorder: (dir: "up" | "down") => void;
  onRemove: () => void;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0); // 0 — 1

  useEffect(() => {
    return () => {
      audioRef.current?.pause();
    };
  }, []);

  function togglePlay() {
    if (!row.audioUrl) return;
    if (!audioRef.current) {
      audioRef.current = new Audio(row.audioUrl);
      audioRef.current.addEventListener("timeupdate", () => {
        const a = audioRef.current;
        if (!a || !a.duration) return;
        setProgress(a.currentTime / a.duration);
      });
      audioRef.current.addEventListener("ended", () => {
        setPlaying(false);
        setProgress(0);
      });
    }
    if (playing) {
      audioRef.current.pause();
      setPlaying(false);
    } else {
      void audioRef.current.play();
      setPlaying(true);
    }
  }

  const bars = useMemo(() => seededBars(row.id), [row.id]);
  const upDisabled = !canReorder("up", index, total);
  const downDisabled = !canReorder("down", index, total);

  return (
    <li>
      <div className="rounded-[1.25rem] p-[3px] bg-[rgb(var(--bg-overlay)/0.4)] ring-1 ring-[rgb(var(--border-subtle))]">
        <div className="flex items-center gap-3 rounded-[calc(1.25rem-3px)] bg-[rgb(var(--bg-base))] px-4 py-3">
          {/* ▲▼ reorder */}
          <div className="flex flex-col gap-0.5">
            <button
              type="button"
              aria-label="Move up"
              disabled={upDisabled}
              onClick={() => {
                onReorder("up");
              }}
              className="grid h-5 w-5 place-items-center rounded-sm text-[rgb(var(--fg-secondary))] transition-colors hover:bg-[rgb(var(--bg-overlay))] hover:text-[rgb(var(--fg-primary))] disabled:opacity-30 disabled:hover:bg-transparent active:scale-[0.92]"
            >
              <svg viewBox="0 0 12 12" className="h-3 w-3" fill="currentColor">
                <path d="M6 3l4 5H2z" />
              </svg>
            </button>
            <button
              type="button"
              aria-label="Move down"
              disabled={downDisabled}
              onClick={() => {
                onReorder("down");
              }}
              className="grid h-5 w-5 place-items-center rounded-sm text-[rgb(var(--fg-secondary))] transition-colors hover:bg-[rgb(var(--bg-overlay))] hover:text-[rgb(var(--fg-primary))] disabled:opacity-30 disabled:hover:bg-transparent active:scale-[0.92]"
            >
              <svg viewBox="0 0 12 12" className="h-3 w-3" fill="currentColor">
                <path d="M6 9l4-5H2z" />
              </svg>
            </button>
          </div>

          {/* play/pause */}
          <button
            type="button"
            aria-label={playing ? "Pause" : "Play"}
            disabled={!row.audioUrl}
            onClick={togglePlay}
            className={[
              "grid h-9 w-9 shrink-0 place-items-center rounded-full transition-all active:scale-[0.94] disabled:cursor-not-allowed disabled:opacity-40",
              playing
                ? "bg-[rgb(var(--brand-primary))] text-[rgb(var(--fg-inverse))]"
                : "border border-[rgb(var(--border-strong))] bg-[rgb(var(--bg-elevated))] text-[rgb(var(--fg-primary))] hover:border-[rgb(var(--brand-primary))]",
            ].join(" ")}
          >
            {playing ? (
              <svg viewBox="0 0 12 12" className="h-3.5 w-3.5" fill="currentColor">
                <rect x="3" y="2" width="2" height="8" />
                <rect x="7" y="2" width="2" height="8" />
              </svg>
            ) : (
              <svg viewBox="0 0 12 12" className="h-3.5 w-3.5" fill="currentColor">
                <path d="M3 2v8l7-4z" />
              </svg>
            )}
          </button>

          {/* waveform (decorative) */}
          <div
            aria-hidden="true"
            className="flex h-9 flex-1 items-center gap-[2px]"
          >
            {bars.map((h, i) => {
              const playedFraction = (i + 1) / bars.length;
              const played = playedFraction <= progress;
              return (
                <span
                  key={i}
                  className="block w-[3px] rounded-full transition-colors"
                  style={{
                    height: `${(h * 100).toFixed(1)}%`,
                    backgroundColor: played
                      ? "rgb(var(--brand-primary))"
                      : "rgb(var(--fg-muted) / 0.35)",
                  }}
                />
              );
            })}
          </div>

          {/* title + artist */}
          <div className="min-w-0 max-w-[40%] shrink-0">
            <p
              className="truncate text-sm text-[rgb(var(--fg-primary))]"
              style={{ fontWeight: 600 }}
            >
              {row.title}
            </p>
            {row.artist ? (
              <p className="truncate text-[11px] text-[rgb(var(--fg-secondary))]">
                {row.artist}
              </p>
            ) : null}
          </div>

          {/* duration */}
          <span className="shrink-0 font-mono text-[11px] text-[rgb(var(--fg-muted))] tabular-nums">
            {formatDuration(row.durationMs)}
          </span>

          {/* public badge */}
          {row.isPublicSample ? (
            <span className="shrink-0 rounded-[var(--radius-sm)] bg-[rgb(var(--brand-primary)/0.14)] px-2 py-0.5 font-mono text-[9.5px] font-medium uppercase tracking-[0.14em] text-[rgb(var(--brand-primary))]">
              Public
            </span>
          ) : null}

          {/* remove (hover) */}
          <button
            type="button"
            aria-label={`Remove ${row.title}`}
            onClick={onRemove}
            className="grid h-6 w-6 shrink-0 place-items-center rounded-sm text-[rgb(var(--fg-secondary))] opacity-0 transition-opacity hover:bg-[rgb(var(--bg-overlay))] hover:text-[rgb(var(--fg-primary))] group-hover/portfolio-row:opacity-100 focus-visible:opacity-100 active:scale-[0.94]"
            style={{ opacity: 0.55 }}
          >
            ×
          </button>
        </div>
      </div>
    </li>
  );
}

// ─── Section: Social links ──────────────────────────────────────────

function SocialLinksSection({
  initialLinks,
}: {
  initialLinks: ExternalLinkRow[];
}) {
  const [rows, setRows] = useState<ExternalLinkRow[]>(initialLinks);
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [, startTransition] = useTransition();
  const router = useRouter();
  const { toast } = useToast();

  useEffect(() => {
    setRows(initialLinks);
  }, [initialLinks]);

  function submit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    const trimmed = url.trim();
    if (!trimmed) return;
    setError(null);
    setAdding(true);
    startTransition(async () => {
      const res = await addExternalLink({ url: trimmed });
      setAdding(false);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setUrl("");
      router.refresh();
    });
  }

  function reorder(index: number, direction: "up" | "down") {
    const next = swapAdjacent(rows, index, direction);
    if (!next) return;
    const orderedIds = next.map((r) => r.id);
    setRows(next);
    startTransition(async () => {
      const res = await reorderExternalLinks({ orderedIds });
      if (!res.ok) {
        toast(res.error, "error");
        setRows(initialLinks);
        return;
      }
      router.refresh();
    });
  }

  function remove(id: string) {
    setRows((all) => all.filter((r) => r.id !== id));
    startTransition(async () => {
      const res = await removeExternalLink({ id });
      if (!res.ok) {
        toast(res.error, "error");
        setRows(initialLinks);
        return;
      }
      router.refresh();
    });
  }

  return (
    <section
      aria-labelledby="portfolio-links-heading"
      className="sk-portfolio-section"
    >
      <header className="mb-4">
        <h2
          id="portfolio-links-heading"
          className="font-display text-2xl tracking-tight text-[rgb(var(--fg-primary))]"
          style={{ fontWeight: 700 }}
        >
          Social links
        </h2>
        <p className="mt-1 font-mono text-[10.5px] uppercase tracking-[0.16em] text-[rgb(var(--fg-muted))]">
          PASTE THE URL. WE FIGURE OUT THE PLATFORM.
        </p>
      </header>

      <form onSubmit={submit} className="mb-4">
        <div className="flex items-center gap-2 rounded-full border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-base))] px-2 py-1.5 transition-colors focus-within:border-[rgb(var(--brand-primary)/0.55)]">
          <input
            type="url"
            value={url}
            onChange={(e) => {
              setUrl(e.target.value);
              if (error) setError(null);
            }}
            placeholder="Paste a Spotify, YouTube, SoundCloud link…"
            className="min-w-0 flex-1 bg-transparent px-3 text-sm text-[rgb(var(--fg-primary))] placeholder:text-[rgb(var(--fg-muted))] focus:outline-none"
          />
          <button
            type="submit"
            disabled={adding || !url.trim()}
            className="inline-flex items-center gap-1.5 rounded-full bg-[rgb(var(--brand-primary))] px-3.5 py-1.5 text-xs font-medium text-[rgb(var(--fg-inverse))] transition-opacity hover:opacity-90 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <span>{adding ? "Adding…" : "Add"}</span>
            <span
              aria-hidden="true"
              className="grid h-4 w-4 place-items-center rounded-full bg-[rgb(var(--fg-inverse)/0.18)] text-[10px] transition-transform group-hover/add-btn:translate-x-[2px] group-hover/add-btn:-translate-y-[1px]"
            >
              ↗
            </span>
          </button>
        </div>
        {error ? (
          <p
            role="alert"
            className="mt-2 font-mono text-[10.5px] uppercase tracking-[0.12em] text-[rgb(var(--brand-primary))]"
          >
            {error}
          </p>
        ) : null}
      </form>

      {rows.length === 0 ? (
        <div
          role="status"
          className="rounded-[var(--radius-lg)] border border-dashed border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-sunken))] px-6 py-10 text-center"
        >
          <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-[rgb(var(--fg-muted))]">
            NO LINKS YET. PASTE A SPOTIFY OR YOUTUBE LINK ABOVE.
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {rows.map((row, idx) => (
            <LinkRow
              key={row.id}
              row={row}
              index={idx}
              total={rows.length}
              onReorder={(dir) => {
                reorder(idx, dir);
              }}
              onRemove={() => {
                remove(row.id);
              }}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function LinkRow({
  row,
  index,
  total,
  onReorder,
  onRemove,
}: {
  row: ExternalLinkRow;
  index: number;
  total: number;
  onReorder: (dir: "up" | "down") => void;
  onRemove: () => void;
}) {
  const upDisabled = !canReorder("up", index, total);
  const downDisabled = !canReorder("down", index, total);

  return (
    <li>
      <div className="rounded-[1.25rem] p-[3px] bg-[rgb(var(--bg-overlay)/0.4)] ring-1 ring-[rgb(var(--border-subtle))]">
        <div className="flex items-center gap-3 rounded-[calc(1.25rem-3px)] bg-[rgb(var(--bg-base))] px-4 py-2.5">
          <div className="flex flex-col gap-0.5">
            <button
              type="button"
              aria-label="Move up"
              disabled={upDisabled}
              onClick={() => {
                onReorder("up");
              }}
              className="grid h-5 w-5 place-items-center rounded-sm text-[rgb(var(--fg-secondary))] transition-colors hover:bg-[rgb(var(--bg-overlay))] hover:text-[rgb(var(--fg-primary))] disabled:opacity-30 disabled:hover:bg-transparent active:scale-[0.92]"
            >
              <svg viewBox="0 0 12 12" className="h-3 w-3" fill="currentColor">
                <path d="M6 3l4 5H2z" />
              </svg>
            </button>
            <button
              type="button"
              aria-label="Move down"
              disabled={downDisabled}
              onClick={() => {
                onReorder("down");
              }}
              className="grid h-5 w-5 place-items-center rounded-sm text-[rgb(var(--fg-secondary))] transition-colors hover:bg-[rgb(var(--bg-overlay))] hover:text-[rgb(var(--fg-primary))] disabled:opacity-30 disabled:hover:bg-transparent active:scale-[0.92]"
            >
              <svg viewBox="0 0 12 12" className="h-3 w-3" fill="currentColor">
                <path d="M6 9l4-5H2z" />
              </svg>
            </button>
          </div>
          <div className="min-w-0 flex-1">
            <p
              className="text-sm text-[rgb(var(--fg-primary))]"
              style={{ fontWeight: 600 }}
            >
              {PLATFORM_LABEL[row.platform]}
            </p>
            <a
              href={row.url}
              target="_blank"
              rel="noreferrer noopener"
              className="block truncate font-mono text-[11px] text-[rgb(var(--fg-muted))] hover:text-[rgb(var(--fg-secondary))]"
            >
              {row.url}
            </a>
          </div>
          <button
            type="button"
            aria-label={`Remove ${PLATFORM_LABEL[row.platform]} link`}
            onClick={onRemove}
            className="grid h-6 w-6 shrink-0 place-items-center rounded-sm text-[rgb(var(--fg-secondary))] transition-opacity hover:bg-[rgb(var(--bg-overlay))] hover:text-[rgb(var(--fg-primary))] active:scale-[0.94]"
            style={{ opacity: 0.55 }}
          >
            ×
          </button>
        </div>
      </div>
    </li>
  );
}

// ─── Add from library button + picker modal ─────────────────────────

function AddFromLibraryButton({
  library,
  addedAudioUrls,
  disabled,
  ghost = false,
}: {
  library: LibraryPickRow[];
  addedAudioUrls: string[];
  disabled: boolean;
  ghost?: boolean;
}) {
  const addedSet = useMemo(() => new Set(addedAudioUrls), [addedAudioUrls]);
  const [open, setOpen] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const router = useRouter();
  const { toast } = useToast();

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function pick(row: LibraryPickRow) {
    if (!row.audioUrl) return;
    if (addedSet.has(row.audioUrl)) return;
    setPendingId(row.versionId);
    startTransition(async () => {
      const res = await addPortfolioFromLibrary({
        title: row.trackTitle,
        artist: row.artistName,
        audioUrl: row.audioUrl as string,
      });
      setPendingId(null);
      if (!res.ok) {
        toast(res.error, "error");
        return;
      }
      setOpen(false);
      router.refresh();
    });
  }

  const triggerClasses = ghost
    ? "inline-flex items-center gap-1.5 rounded-full border border-[rgb(var(--border-strong))] bg-transparent px-3.5 py-1.5 text-xs font-medium text-[rgb(var(--fg-primary))] transition-colors hover:bg-[rgb(var(--bg-overlay))] disabled:cursor-not-allowed disabled:opacity-50 active:scale-[0.98]"
    : "inline-flex items-center gap-1.5 rounded-full bg-[rgb(var(--brand-primary))] px-3.5 py-1.5 text-xs font-medium text-[rgb(var(--fg-inverse))] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 active:scale-[0.98]";

  return (
    <>
      <button
        type="button"
        disabled={disabled}
        onClick={() => {
          setOpen(true);
        }}
        className={triggerClasses}
      >
        <span>Add from music library</span>
        <span
          aria-hidden="true"
          className={
            ghost
              ? "grid h-4 w-4 place-items-center rounded-full border border-[rgb(var(--border-strong))] text-[10px]"
              : "grid h-4 w-4 place-items-center rounded-full bg-[rgb(var(--fg-inverse)/0.18)] text-[10px]"
          }
        >
          +
        </span>
      </button>

      {open ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="library-picker-title"
          className="fixed inset-0 z-50 flex items-center justify-center px-4"
        >
          <button
            type="button"
            aria-label="Close"
            onClick={() => {
              setOpen(false);
            }}
            className="absolute inset-0 bg-black/55 backdrop-blur-sm"
          />
          <div className="relative z-10 flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-[var(--radius-lg)] border border-[rgb(var(--border-strong))] bg-[rgb(var(--bg-elevated))] shadow-xl">
            <header className="flex items-start justify-between gap-3 border-b border-[rgb(var(--border-subtle))] px-5 py-4">
              <div>
                <h3
                  id="library-picker-title"
                  className="font-display text-lg tracking-tight"
                  style={{ fontWeight: 700 }}
                >
                  Add from music library
                </h3>
                <p className="mt-1 text-xs text-[rgb(var(--fg-secondary))]">
                  Tracks without audio yet can&rsquo;t be added.
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                }}
                aria-label="Close picker"
                className="-mr-2 -mt-1 inline-flex h-8 w-8 items-center justify-center rounded-[var(--radius-sm)] text-[rgb(var(--fg-secondary))] transition-colors hover:bg-[rgb(var(--bg-overlay))] hover:text-[rgb(var(--fg-primary))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))]"
              >
                ×
              </button>
            </header>
            <div className="overflow-y-auto px-2 py-2">
              {library.length === 0 ? (
                <p className="px-3 py-8 text-center text-sm text-[rgb(var(--fg-secondary))]">
                  Your music library is empty. Upload a track from a project
                  first.
                </p>
              ) : (
                <ul className="divide-y divide-[rgb(var(--border-subtle))]">
                  {library.map((row) => {
                    const alreadyAdded = row.audioUrl
                      ? addedSet.has(row.audioUrl)
                      : false;
                    const noAudio = !row.audioUrl;
                    const rowDisabled = noAudio || alreadyAdded;
                    const pending = pendingId === row.versionId;
                    const date = new Date(row.uploadedAt).toLocaleDateString(
                      undefined,
                      { year: "numeric", month: "short", day: "numeric" },
                    );
                    return (
                      <li key={row.versionId}>
                        <button
                          type="button"
                          disabled={rowDisabled || pending}
                          onClick={() => {
                            pick(row);
                          }}
                          className={[
                            "flex w-full flex-col items-start gap-1 px-3 py-3 text-left transition-colors",
                            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[rgb(var(--brand-primary))]",
                            rowDisabled
                              ? "cursor-not-allowed opacity-50"
                              : "hover:bg-[rgb(var(--bg-overlay))]",
                            pending ? "opacity-60" : "",
                          ].join(" ")}
                        >
                          <span
                            className="text-sm text-[rgb(var(--fg-primary))]"
                            style={{ fontWeight: 600 }}
                          >
                            {row.trackTitle}
                          </span>
                          <span className="font-mono text-[0.66rem] uppercase tracking-[0.14em] text-[rgb(var(--fg-muted))]">
                            {row.projectTitle} · {row.artistName} · {date}
                          </span>
                          {alreadyAdded ? (
                            <span className="mt-1 inline-flex items-center rounded-[var(--radius-sm)] bg-[rgb(var(--brand-primary)/0.15)] px-2 py-0.5 text-[0.66rem] font-medium uppercase tracking-wider text-[rgb(var(--brand-primary))]">
                              Already added
                            </span>
                          ) : noAudio ? (
                            <span className="mt-1 inline-flex items-center rounded-[var(--radius-sm)] bg-[rgb(var(--fg-muted)/0.15)] px-2 py-0.5 text-[0.66rem] font-medium uppercase tracking-wider text-[rgb(var(--fg-secondary))]">
                              No audio yet
                            </span>
                          ) : null}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
