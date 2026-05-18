"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type SyntheticEvent,
} from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";

import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

import { useToast } from "~/components/ui/toast";
import { PlatformIcon } from "~/components/portfolio/platform-icons";

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
  // Pre-computed RMS peaks (~200 normalized values, 0..1) from
  // trackVersions.peaks via the LEFT JOIN in portfolio.list. null when
  // the source track has no peaks yet (legacy upload, decoder miss, or
  // the row's audioR2Key didn't match a trackVersion) — the UI then
  // falls back to a deterministic decorative bar set.
  peaks: number[] | null;
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
 * when the swap would step out of bounds. Pure: does not mutate `arr`.
 * Kept as an exported utility for unit tests; the runtime UI uses
 * @dnd-kit/sortable's `arrayMove` for drag-and-drop reorder.
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
 * from a track id. Used as a fallback when the source trackVersion has
 * no pre-computed peaks (legacy uploads, decoder misses, or rows whose
 * audioR2Key didn't match a trackVersion in portfolio.list).
 */
export function seededBars(id: string, count = 80): number[] {
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

/**
 * Downsample a peaks array (typically 200 values from
 * trackVersions.peaks) into `targetCount` bars by taking the MAX of
 * each chunk. Max preserves the dynamic punch of the waveform — using
 * a mean would flatten transients to a wall of mid-grey bars. If the
 * input already has ≤ targetCount values it is returned untouched.
 */
export function downsamplePeaks(
  peaks: readonly number[],
  targetCount = 80,
): number[] {
  if (peaks.length === 0) return [];
  if (peaks.length <= targetCount) return peaks.slice();
  const chunkSize = peaks.length / targetCount;
  const out: number[] = [];
  for (let i = 0; i < targetCount; i++) {
    const start = Math.floor(i * chunkSize);
    const end = Math.max(start + 1, Math.floor((i + 1) * chunkSize));
    let max = 0;
    for (let j = start; j < end && j < peaks.length; j++) {
      const p = peaks[j] ?? 0;
      if (p > max) max = p;
    }
    out.push(max);
  }
  return out;
}

/** ms → "m:ss" or empty string. */
export function formatDuration(ms: number | null): string {
  if (!ms || ms <= 0) return "";
  const totalSec = Math.round(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m.toString()}:${s.toString().padStart(2, "0")}`;
}

/** Kept for legacy callers + tests; not used by the drag-driven UI. */
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

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const atCap = rows.length >= TRACK_CAP;

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = rows.findIndex((r) => r.id === active.id);
    const newIndex = rows.findIndex((r) => r.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    const next = arrayMove(rows, oldIndex, newIndex);
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
      <header className="mb-5 flex items-end justify-between gap-3">
        <div>
          <h2
            id="portfolio-tracks-heading"
            className="font-display text-2xl leading-none tracking-[-0.015em] text-[rgb(var(--fg-primary))]"
            style={{ fontWeight: 700 }}
          >
            Featured tracks
          </h2>
          <p className="mt-2 font-mono text-[10.5px] uppercase tracking-[0.18em] text-[rgb(var(--fg-muted))]">
            PICK YOUR BEST. DRAG TO REORDER.
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
          className="mb-3 font-mono text-[10.5px] uppercase tracking-[0.16em] text-[rgb(var(--fg-muted))]"
        >
          LIMIT REACHED ({TRACK_CAP}/{TRACK_CAP})
        </p>
      ) : null}

      {rows.length === 0 ? (
        <FeaturedTracksEmpty />
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={rows.map((r) => r.id)}
            strategy={verticalListSortingStrategy}
          >
            <ul className="space-y-2.5">
              {rows.map((row) => (
                <TrackRow
                  key={row.id}
                  row={row}
                  onRemove={() => {
                    remove(row.id);
                  }}
                />
              ))}
            </ul>
          </SortableContext>
        </DndContext>
      )}
    </section>
  );
}

function FeaturedTracksEmpty() {
  return (
    <div
      role="status"
      className="rounded-[var(--radius-lg)] border border-dashed border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-sunken)/0.6)] px-6 py-14 text-center"
    >
      <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[rgb(var(--fg-muted))]">
        NO FEATURED TRACKS YET. ADD ONE FROM YOUR MUSIC LIBRARY.
      </p>
    </div>
  );
}

function TrackRow({
  row,
  onRemove,
}: {
  row: PortfolioTrackRow;
  onRemove: () => void;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: row.id });

  const sortableStyle: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 10 : "auto",
  };

  useEffect(() => {
    return () => {
      audioRef.current?.pause();
    };
  }, []);

  function ensureAudio(): HTMLAudioElement | null {
    if (!row.audioUrl) return null;
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
    return audioRef.current;
  }

  function togglePlay() {
    const a = ensureAudio();
    if (!a) return;
    if (playing) {
      a.pause();
      setPlaying(false);
    } else {
      void a.play();
      setPlaying(true);
    }
  }

  function seekToFraction(fraction: number) {
    const clamped = Math.max(0, Math.min(1, fraction));
    const a = ensureAudio();
    if (!a) return;
    if (a.duration && Number.isFinite(a.duration)) {
      a.currentTime = clamped * a.duration;
      setProgress(clamped);
    } else {
      // duration not loaded yet — set once metadata arrives
      a.addEventListener(
        "loadedmetadata",
        () => {
          a.currentTime = clamped * a.duration;
          setProgress(clamped);
        },
        { once: true },
      );
    }
    if (!playing) {
      void a.play();
      setPlaying(true);
    }
  }

  function onWaveClick(e: ReactMouseEvent<HTMLButtonElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    if (rect.width === 0) return;
    const fraction = (e.clientX - rect.left) / rect.width;
    seekToFraction(fraction);
  }

  // Real peaks if available (downsampled to 80 bars), else the
  // deterministic decorative fallback.
  const bars = useMemo(() => {
    if (row.peaks && row.peaks.length > 0) {
      return downsamplePeaks(row.peaks, 80);
    }
    return seededBars(row.id, 80);
  }, [row.peaks, row.id]);

  return (
    <li ref={setNodeRef} style={sortableStyle} className="group/track">
      <div className="rounded-[1.25rem] p-[3px] bg-[rgb(var(--bg-overlay)/0.55)] ring-1 ring-[rgb(var(--border-subtle))] group-hover/track:ring-[rgb(var(--border-strong))] transition-[box-shadow,background-color] duration-300 ease-out">
        <div className="flex items-center gap-2 rounded-[calc(1.25rem-3px)] bg-[rgb(var(--bg-elevated))] px-3 py-3 shadow-[0_1px_2px_rgb(0_0_0_/_0.04)]">
          {/* drag handle (lives outside the column-separated zone) */}
          <button
            type="button"
            className="grid h-7 w-5 shrink-0 cursor-grab touch-none place-items-center rounded-sm text-[rgb(var(--fg-muted))] transition-colors hover:bg-[rgb(var(--bg-overlay))] hover:text-[rgb(var(--fg-primary))] active:cursor-grabbing"
            {...attributes}
            {...listeners}
            aria-label="Drag to reorder"
          >
            <svg viewBox="0 0 8 14" className="h-3.5 w-3.5" fill="currentColor" aria-hidden="true">
              <circle cx="2" cy="2.5" r="1.1" />
              <circle cx="6" cy="2.5" r="1.1" />
              <circle cx="2" cy="7" r="1.1" />
              <circle cx="6" cy="7" r="1.1" />
              <circle cx="2" cy="11.5" r="1.1" />
              <circle cx="6" cy="11.5" r="1.1" />
            </svg>
          </button>

          {/* columns: play | waveform | name | public — separated by hairlines */}
          <div className="flex flex-1 items-center min-w-0">
            {/* col: play */}
            <div className="flex shrink-0 items-center px-2">
              <button
                type="button"
                aria-label={playing ? "Pause" : "Play"}
                disabled={!row.audioUrl}
                onClick={togglePlay}
                className={[
                  "grid h-9 w-9 shrink-0 place-items-center rounded-full transition-all duration-200 ease-out active:scale-[0.94] disabled:cursor-not-allowed disabled:opacity-40",
                  playing
                    ? "bg-[rgb(var(--brand-primary))] text-[rgb(var(--fg-inverse))] shadow-[0_6px_16px_-6px_rgb(var(--brand-primary)/0.55)]"
                    : "border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-base))] text-[rgb(var(--fg-primary))] hover:border-[rgb(var(--fg-primary))]",
                ].join(" ")}
              >
                {playing ? (
                  <svg viewBox="0 0 12 12" className="h-3.5 w-3.5" fill="currentColor">
                    <rect x="3" y="2" width="2" height="8" rx="0.5" />
                    <rect x="7" y="2" width="2" height="8" rx="0.5" />
                  </svg>
                ) : (
                  <svg viewBox="0 0 12 12" className="ml-[1px] h-3.5 w-3.5" fill="currentColor">
                    <path d="M3 2v8l7-4z" />
                  </svg>
                )}
              </button>
            </div>

            <Separator />

            {/* col: waveform (clickable to seek; bars stretch to fill) */}
            <button
              type="button"
              aria-label="Seek"
              onClick={onWaveClick}
              disabled={!row.audioUrl}
              className="flex h-10 flex-1 min-w-0 items-center gap-[2px] px-3 transition-opacity duration-200 ease-out disabled:cursor-not-allowed disabled:opacity-40"
            >
              {bars.map((h, i) => {
                const playedFraction = (i + 1) / bars.length;
                const played = playedFraction <= progress;
                return (
                  <span
                    key={i}
                    aria-hidden="true"
                    className="block min-w-[2px] flex-1 rounded-full transition-colors duration-300 ease-out"
                    style={{
                      height: `${(Math.max(0.08, h) * 100).toFixed(1)}%`,
                      backgroundColor: played
                        ? "rgb(var(--brand-primary))"
                        : "rgb(var(--fg-muted) / 0.34)",
                    }}
                  />
                );
              })}
            </button>

            <Separator />

            {/* col: name + artist + duration */}
            <div className="min-w-0 shrink-0 px-3" style={{ width: 156 }}>
              <p
                className="truncate text-[13.5px] leading-tight text-[rgb(var(--fg-primary))]"
                style={{ fontWeight: 600, letterSpacing: "-0.005em" }}
              >
                {row.title}
              </p>
              <p className="mt-0.5 truncate text-[11px] leading-tight text-[rgb(var(--fg-secondary))]">
                {row.artist ? `${row.artist} · ` : ""}
                <span className="font-mono tabular-nums text-[rgb(var(--fg-muted))]">
                  {formatDuration(row.durationMs)}
                </span>
              </p>
            </div>

            <Separator />

            {/* col: public badge (or empty placeholder so column width is stable) */}
            <div className="flex shrink-0 items-center px-2">
              {row.isPublicSample ? (
                <span
                  className="rounded-full bg-[rgb(var(--brand-primary)/0.12)] px-2.5 py-1 font-mono text-[9.5px] font-medium uppercase tracking-[0.16em] text-[rgb(var(--brand-primary))]"
                  style={{
                    boxShadow:
                      "inset 0 0 0 1px rgb(var(--brand-primary) / 0.2)",
                  }}
                >
                  Public
                </span>
              ) : (
                <span
                  aria-hidden="true"
                  className="font-mono text-[9.5px] uppercase tracking-[0.16em] text-[rgb(var(--fg-muted)/0.45)]"
                >
                  Private
                </span>
              )}
            </div>
          </div>

          {/* remove (hover-revealed, sits outside the separator zone) */}
          <button
            type="button"
            aria-label={`Remove ${row.title}`}
            onClick={onRemove}
            className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-[rgb(var(--fg-muted))] opacity-0 transition-all duration-200 ease-out hover:bg-[rgb(var(--bg-overlay))] hover:text-[rgb(var(--fg-primary))] focus-visible:opacity-100 group-hover/track:opacity-100 active:scale-[0.92]"
          >
            <svg viewBox="0 0 12 12" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              <path d="M3 3l6 6M9 3l-6 6" />
            </svg>
          </button>
        </div>
      </div>
    </li>
  );
}

// Subtle vertical separator between row columns. Inset top + bottom by
// half the row padding so it reads as a hairline divider rather than
// touching the inner card edges.
function Separator() {
  return (
    <span
      aria-hidden="true"
      className="block h-6 w-px shrink-0 bg-[rgb(var(--border-subtle))]"
    />
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

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = rows.findIndex((r) => r.id === active.id);
    const newIndex = rows.findIndex((r) => r.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    const next = arrayMove(rows, oldIndex, newIndex);
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
      <header className="mb-5">
        <h2
          id="portfolio-links-heading"
          className="font-display text-2xl leading-none tracking-[-0.015em] text-[rgb(var(--fg-primary))]"
          style={{ fontWeight: 700 }}
        >
          Social links
        </h2>
        <p className="mt-2 font-mono text-[10.5px] uppercase tracking-[0.18em] text-[rgb(var(--fg-muted))]">
          PASTE THE URL. WE FIGURE OUT THE PLATFORM.
        </p>
      </header>

      <form onSubmit={submit} className="mb-5">
        <div className="flex items-center gap-2 rounded-full bg-[rgb(var(--bg-elevated))] px-2 py-1.5 ring-1 ring-[rgb(var(--border-subtle))] transition-[box-shadow,background-color] duration-300 ease-out focus-within:ring-[rgb(var(--brand-primary)/0.6)] focus-within:bg-[rgb(var(--bg-base))]">
          <input
            type="url"
            value={url}
            onChange={(e) => {
              setUrl(e.target.value);
              if (error) setError(null);
            }}
            placeholder="Paste a Spotify, YouTube, SoundCloud link…"
            className="min-w-0 flex-1 bg-transparent px-3 text-sm text-[rgb(var(--fg-primary))] placeholder:text-[rgb(var(--fg-muted))] focus:outline-none"
            style={{ letterSpacing: "-0.005em" }}
          />
          <button
            type="submit"
            disabled={adding || !url.trim()}
            className="group/add-link inline-flex items-center gap-1.5 rounded-full bg-[rgb(var(--brand-primary))] px-3.5 py-1.5 text-xs font-medium text-[rgb(var(--fg-inverse))] transition-all duration-200 ease-out hover:bg-[rgb(var(--brand-primary)/0.92)] active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <span>{adding ? "Adding…" : "Add"}</span>
            <span
              aria-hidden="true"
              className="grid h-4 w-4 place-items-center rounded-full bg-[rgb(var(--fg-inverse)/0.22)] text-[10px] transition-transform duration-300 ease-out group-hover/add-link:translate-x-[2px] group-hover/add-link:-translate-y-[1px]"
            >
              ↗
            </span>
          </button>
        </div>
        {error ? (
          <p
            role="alert"
            className="mt-2 font-mono text-[10.5px] uppercase tracking-[0.14em] text-[rgb(var(--brand-primary))]"
          >
            {error}
          </p>
        ) : null}
      </form>

      {rows.length === 0 ? (
        <div
          role="status"
          className="rounded-[var(--radius-lg)] border border-dashed border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-sunken)/0.6)] px-6 py-12 text-center"
        >
          <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[rgb(var(--fg-muted))]">
            NO LINKS YET. PASTE A SPOTIFY OR YOUTUBE LINK ABOVE.
          </p>
        </div>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={rows.map((r) => r.id)}
            strategy={verticalListSortingStrategy}
          >
            <ul className="space-y-2">
              {rows.map((row) => (
                <LinkRow
                  key={row.id}
                  row={row}
                  onRemove={() => {
                    remove(row.id);
                  }}
                />
              ))}
            </ul>
          </SortableContext>
        </DndContext>
      )}
    </section>
  );
}

function LinkRow({
  row,
  onRemove,
}: {
  row: ExternalLinkRow;
  onRemove: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: row.id });

  const sortableStyle: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 10 : "auto",
  };

  return (
    <li ref={setNodeRef} style={sortableStyle} className="group/link">
      <div className="rounded-[1.25rem] p-[3px] bg-[rgb(var(--bg-overlay)/0.55)] ring-1 ring-[rgb(var(--border-subtle))] group-hover/link:ring-[rgb(var(--border-strong))] transition-[box-shadow,background-color] duration-300 ease-out">
        <div className="flex items-center gap-3 rounded-[calc(1.25rem-3px)] bg-[rgb(var(--bg-elevated))] px-3.5 py-2.5 shadow-[0_1px_2px_rgb(0_0_0_/_0.04)]">
          {/* drag handle */}
          <button
            type="button"
            className="grid h-7 w-5 shrink-0 cursor-grab touch-none place-items-center rounded-sm text-[rgb(var(--fg-muted))] transition-colors hover:bg-[rgb(var(--bg-overlay))] hover:text-[rgb(var(--fg-primary))] active:cursor-grabbing"
            {...attributes}
            {...listeners}
            aria-label="Drag to reorder"
          >
            <svg viewBox="0 0 8 14" className="h-3.5 w-3.5" fill="currentColor" aria-hidden="true">
              <circle cx="2" cy="2.5" r="1.1" />
              <circle cx="6" cy="2.5" r="1.1" />
              <circle cx="2" cy="7" r="1.1" />
              <circle cx="6" cy="7" r="1.1" />
              <circle cx="2" cy="11.5" r="1.1" />
              <circle cx="6" cy="11.5" r="1.1" />
            </svg>
          </button>

          {/* platform brand icon */}
          <PlatformIcon platform={row.platform} size={32} />

          {/* platform name + truncated URL */}
          <div className="min-w-0 flex-1">
            <p
              className="text-[13.5px] leading-tight text-[rgb(var(--fg-primary))]"
              style={{ fontWeight: 600, letterSpacing: "-0.005em" }}
            >
              {PLATFORM_LABEL[row.platform]}
            </p>
            <a
              href={row.url}
              target="_blank"
              rel="noreferrer noopener"
              className="mt-0.5 block truncate font-mono text-[11px] text-[rgb(var(--fg-muted))] transition-colors duration-200 ease-out hover:text-[rgb(var(--fg-secondary))]"
            >
              {row.url}
            </a>
          </div>

          {/* remove (hover-revealed) */}
          <button
            type="button"
            aria-label={`Remove ${PLATFORM_LABEL[row.platform]} link`}
            onClick={onRemove}
            className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-[rgb(var(--fg-muted))] opacity-0 transition-all duration-200 ease-out hover:bg-[rgb(var(--bg-overlay))] hover:text-[rgb(var(--fg-primary))] focus-visible:opacity-100 group-hover/link:opacity-100 active:scale-[0.92]"
          >
            <svg viewBox="0 0 12 12" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              <path d="M3 3l6 6M9 3l-6 6" />
            </svg>
          </button>
        </div>
      </div>
    </li>
  );
}

// ─── Add from library button + picker modal (portal-rendered) ──────

function AddFromLibraryButton({
  library,
  addedAudioUrls,
  disabled,
}: {
  library: LibraryPickRow[];
  addedAudioUrls: string[];
  disabled: boolean;
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

  return (
    <>
      <button
        type="button"
        disabled={disabled}
        onClick={() => {
          setOpen(true);
        }}
        className="group/add-lib inline-flex items-center gap-1.5 rounded-full bg-[rgb(var(--brand-primary))] px-3.5 py-1.5 text-xs font-medium text-[rgb(var(--fg-inverse))] transition-all duration-200 ease-out hover:bg-[rgb(var(--brand-primary)/0.92)] active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50"
      >
        <span>Add from music library</span>
        <span
          aria-hidden="true"
          className="grid h-4 w-4 place-items-center rounded-full bg-[rgb(var(--fg-inverse)/0.22)] text-[10px] transition-transform duration-300 ease-out group-hover/add-lib:translate-x-[1px] group-hover/add-lib:-translate-y-[1px]"
        >
          +
        </span>
      </button>

      <LibraryPickerModal
        open={open}
        library={library}
        addedSet={addedSet}
        pendingId={pendingId}
        onClose={() => {
          setOpen(false);
        }}
        onPick={pick}
      />
    </>
  );
}

function LibraryPickerModal({
  open,
  library,
  addedSet,
  pendingId,
  onClose,
  onPick,
}: {
  open: boolean;
  library: LibraryPickRow[];
  addedSet: Set<string>;
  pendingId: string | null;
  onClose: () => void;
  onPick: (row: LibraryPickRow) => void;
}) {
  const [mounted, setMounted] = useState(false);
  const [visible, setVisible] = useState(false);

  // Two phases: mount the DOM, then add the `data-open` attribute on
  // the next frame so the transition has something to interpolate from.
  // Without the rAF hop the backdrop blur would snap in instead of
  // fading.
  useEffect(() => {
    if (!open) {
      setVisible(false);
      const t = window.setTimeout(() => {
        setMounted(false);
      }, 220);
      return () => {
        window.clearTimeout(t);
      };
    }
    setMounted(true);
    const raf = window.requestAnimationFrame(() => {
      setVisible(true);
    });
    return () => {
      window.cancelAnimationFrame(raf);
    };
  }, [open]);

  if (!mounted || typeof window === "undefined") return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="library-picker-title"
      data-open={visible ? "true" : "false"}
      className="fixed inset-0 z-[100] flex items-center justify-center px-4"
      style={{ opacity: visible ? 1 : 0, transition: "opacity 220ms ease-out" }}
    >
      {/* full-viewport soft glass backdrop, fades in */}
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 cursor-default"
        style={{
          backgroundColor: "rgb(var(--bg-base) / 0.5)",
          backdropFilter: visible ? "blur(14px)" : "blur(0px)",
          WebkitBackdropFilter: visible ? "blur(14px)" : "blur(0px)",
          transition:
            "backdrop-filter 280ms ease-out, -webkit-backdrop-filter 280ms ease-out",
        }}
      />
      {/* modal card — centered, with subtle scale-in for entry */}
      <div
        className="relative z-10 flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))]"
        style={{
          boxShadow:
            "0 24px 64px -16px rgb(17 16 9 / 0.18), 0 6px 12px -4px rgb(17 16 9 / 0.08)",
          transform: visible ? "scale(1) translateY(0)" : "scale(0.97) translateY(8px)",
          transition:
            "transform 260ms cubic-bezier(0.16, 1, 0.3, 1), opacity 220ms ease-out",
          opacity: visible ? 1 : 0,
        }}
      >
        <header className="flex items-start justify-between gap-3 border-b border-[rgb(var(--border-subtle))] px-6 py-5">
          <div>
            <h3
              id="library-picker-title"
              className="font-display text-lg leading-none tracking-[-0.015em] text-[rgb(var(--fg-primary))]"
              style={{ fontWeight: 700 }}
            >
              Add from music library
            </h3>
            <p className="mt-1.5 text-xs text-[rgb(var(--fg-secondary))]">
              Tracks without audio yet can&rsquo;t be added.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close picker"
            className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-[rgb(var(--fg-secondary))] transition-all duration-200 ease-out hover:bg-[rgb(var(--bg-overlay))] hover:text-[rgb(var(--fg-primary))] active:scale-[0.92] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))]"
          >
            <svg viewBox="0 0 12 12" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              <path d="M3 3l6 6M9 3l-6 6" />
            </svg>
          </button>
        </header>
        <PickerList
          library={library}
          addedSet={addedSet}
          pendingId={pendingId}
          onPick={onPick}
        />
      </div>
    </div>,
    window.document.body,
  );
}

function PickerList({
  library,
  addedSet,
  pendingId,
  onPick,
}: {
  library: LibraryPickRow[];
  addedSet: Set<string>;
  pendingId: string | null;
  onPick: (row: LibraryPickRow) => void;
}): ReactNode {
  if (library.length === 0) {
    return (
      <p className="px-6 py-10 text-center text-sm text-[rgb(var(--fg-secondary))]">
        Your music library is empty. Upload a track from a project first.
      </p>
    );
  }
  return (
    <ul className="space-y-1.5 overflow-y-auto p-3">
      {library.map((row) => {
        const alreadyAdded = row.audioUrl ? addedSet.has(row.audioUrl) : false;
        const noAudio = !row.audioUrl;
        const rowDisabled = noAudio || alreadyAdded;
        const pending = pendingId === row.versionId;
        const date = new Date(row.uploadedAt).toLocaleDateString(undefined, {
          year: "numeric",
          month: "short",
          day: "numeric",
        });
        return (
          <li key={row.versionId}>
            <button
              type="button"
              disabled={rowDisabled || pending}
              onClick={() => {
                onPick(row);
              }}
              className={[
                "flex w-full flex-col items-start gap-1 rounded-[var(--radius-md)] px-3.5 py-3 text-left transition-all duration-200 ease-out",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))]",
                rowDisabled
                  ? "cursor-not-allowed opacity-50"
                  : "hover:bg-[rgb(var(--bg-overlay))] active:scale-[0.995]",
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
                <span className="mt-1 inline-flex items-center rounded-full bg-[rgb(var(--brand-primary)/0.15)] px-2 py-0.5 text-[0.66rem] font-medium uppercase tracking-wider text-[rgb(var(--brand-primary))]">
                  Already added
                </span>
              ) : noAudio ? (
                <span className="mt-1 inline-flex items-center rounded-full bg-[rgb(var(--fg-muted)/0.15)] px-2 py-0.5 text-[0.66rem] font-medium uppercase tracking-wider text-[rgb(var(--fg-secondary))]">
                  No audio yet
                </span>
              ) : null}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
