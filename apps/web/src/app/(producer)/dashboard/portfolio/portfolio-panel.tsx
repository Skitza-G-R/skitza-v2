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

  // Real peaks if available (downsampled to 56 bars to fit the
  // waveform column without overflowing into the public label), else
  // the deterministic decorative fallback at the same density.
  const bars = useMemo(() => {
    if (row.peaks && row.peaks.length > 0) {
      return downsamplePeaks(row.peaks, 56);
    }
    return seededBars(row.id, 56);
  }, [row.peaks, row.id]);

  return (
    <li ref={setNodeRef} style={sortableStyle} className="group/track">
      <div className="rounded-[1.25rem] p-[3px] bg-[rgb(var(--bg-overlay)/0.55)] ring-1 ring-[rgb(var(--border-subtle))] group-hover/track:ring-[rgb(var(--border-strong))] transition-[box-shadow,background-color] duration-300 ease-out">
        <div className="flex items-center gap-3 rounded-[calc(1.25rem-3px)] bg-[rgb(var(--bg-elevated))] px-3.5 py-3 shadow-[0_1px_2px_rgb(0_0_0_/_0.04)]">
          {/* drag handle */}
          <button
            type="button"
            className="grid h-9 w-4 shrink-0 cursor-grab touch-none place-items-center rounded-sm text-[rgb(var(--fg-muted)/0.6)] transition-colors duration-200 ease-out hover:text-[rgb(var(--fg-primary))] group-hover/track:text-[rgb(var(--fg-muted))] active:cursor-grabbing"
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

          {/* col 1: play/pause */}
          <button
            type="button"
            aria-label={playing ? "Pause" : "Play"}
            disabled={!row.audioUrl}
            onClick={togglePlay}
            className={[
              "grid h-11 w-11 shrink-0 place-items-center rounded-full transition-all duration-200 ease-out active:scale-[0.94] disabled:cursor-not-allowed disabled:opacity-40",
              playing
                ? "bg-[rgb(var(--brand-primary))] text-[rgb(var(--fg-inverse))] shadow-[0_8px_22px_-8px_rgb(var(--brand-primary)/0.7)]"
                : "bg-[rgb(var(--bg-base))] text-[rgb(var(--fg-primary))] ring-1 ring-[rgb(var(--border-subtle))] group-hover/track:bg-[rgb(var(--brand-primary))] group-hover/track:text-[rgb(var(--fg-inverse))] group-hover/track:ring-transparent group-hover/track:shadow-[0_6px_18px_-8px_rgb(var(--brand-primary)/0.55)]",
            ].join(" ")}
          >
            {playing ? (
              <svg viewBox="0 0 14 14" className="h-4 w-4" fill="currentColor">
                <rect x="3.5" y="2.5" width="2.2" height="9" rx="0.6" />
                <rect x="8.3" y="2.5" width="2.2" height="9" rx="0.6" />
              </svg>
            ) : (
              <svg viewBox="0 0 14 14" className="ml-[1.5px] h-4 w-4" fill="currentColor">
                <path d="M3.5 2v10l8.5-5z" />
              </svg>
            )}
          </button>

          <Separator />

          {/* col 2: waveform — clickable to seek */}
          <button
            type="button"
            aria-label="Seek"
            onClick={onWaveClick}
            disabled={!row.audioUrl}
            className="flex h-10 flex-1 min-w-0 items-center gap-[2px] transition-opacity duration-200 ease-out disabled:cursor-not-allowed disabled:opacity-40"
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
                      : "rgb(var(--fg-muted) / 0.32)",
                  }}
                />
              );
            })}
          </button>

          <Separator />

          {/* col 3: name + artist · duration */}
          <div className="min-w-0 shrink-0" style={{ width: 168 }}>
            <p
              className="truncate text-[14px] leading-tight text-[rgb(var(--fg-primary))]"
              style={{ fontWeight: 600, letterSpacing: "-0.01em" }}
            >
              {row.title}
            </p>
            <p className="mt-1 truncate text-[11.5px] leading-tight text-[rgb(var(--fg-secondary))]">
              {row.artist ?? "Unknown artist"}
              {formatDuration(row.durationMs) ? (
                <>
                  {" "}
                  <span className="text-[rgb(var(--fg-muted))]">·</span>{" "}
                  <span className="font-mono tabular-nums text-[rgb(var(--fg-muted))]">
                    {formatDuration(row.durationMs)}
                  </span>
                </>
              ) : null}
            </p>
          </div>

          <Separator />

          {/* col 4: public / private mono label — fixed width so the divider sits at a stable x */}
          <div className="flex shrink-0 items-center" style={{ width: 64 }}>
            <span
              aria-hidden="true"
              className={[
                "font-mono text-[9.5px] uppercase tracking-[0.18em] tabular-nums",
                row.isPublicSample
                  ? "text-[rgb(var(--brand-primary))]"
                  : "text-[rgb(var(--fg-muted)/0.55)]",
              ].join(" ")}
              title={row.isPublicSample ? "Plays on /join" : "Hidden from /join"}
            >
              {row.isPublicSample ? "Public" : "Private"}
            </span>
          </div>

          {/* remove (hover-revealed, sits outside the column-divider zone) */}
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

// Visible vertical hairline between row columns. Stronger than
// --border-subtle so it actually shows against the cream inner card;
// inset top + bottom relative to the row height so it reads as a
// divider, not a touching edge.
function Separator() {
  return (
    <span
      aria-hidden="true"
      className="block h-7 w-px shrink-0 bg-[rgb(var(--fg-muted)/0.28)]"
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
            className="inline-flex items-center gap-1.5 rounded-full border border-[rgb(var(--border-strong))] bg-[rgb(var(--bg-elevated))] px-4 py-2 text-xs font-medium text-[rgb(var(--fg-primary))] transition-all duration-200 ease-out hover:bg-[rgb(var(--bg-overlay))] hover:border-[rgb(var(--fg-primary))] active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-[rgb(var(--bg-elevated))]"
          >
            <svg
              viewBox="0 0 16 16"
              className="h-3.5 w-3.5 shrink-0"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <path d="M8 3v10M3 8h10" />
            </svg>
            <span>{adding ? "Adding…" : "Add"}</span>
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
        className="inline-flex items-center gap-2 rounded-full border border-[rgb(var(--border-strong))] bg-[rgb(var(--bg-elevated))] px-5 py-2.5 text-sm font-medium text-[rgb(var(--fg-primary))] transition-all duration-200 ease-out hover:bg-[rgb(var(--bg-overlay))] hover:border-[rgb(var(--fg-primary))] active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-[rgb(var(--bg-elevated))]"
      >
        <svg
          viewBox="0 0 16 16"
          className="h-4 w-4 shrink-0"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          aria-hidden="true"
        >
          <path d="M8 3v10M3 8h10" />
        </svg>
        <span>Add from music library</span>
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
      {/* full-viewport soft glass backdrop — light 12% dim + strong blur */}
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 cursor-default"
        style={{
          backgroundColor: "rgb(var(--bg-base) / 0.12)",
          backdropFilter: visible ? "blur(20px)" : "blur(0px)",
          WebkitBackdropFilter: visible ? "blur(20px)" : "blur(0px)",
          transition:
            "backdrop-filter 280ms ease-out, -webkit-backdrop-filter 280ms ease-out",
        }}
      />
      {/* modal card — centered, scaled-in for entry, wider for the table */}
      <div
        className="relative z-10 flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))]"
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
        <PickerTable
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

/**
 * Pure helper exported for unit tests. Case-insensitive substring match
 * against title + project + artist. Empty query returns the input
 * untouched.
 */
export function filterLibrary(
  library: readonly LibraryPickRow[],
  query: string,
): LibraryPickRow[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return library.slice();
  return library.filter((row) => {
    return (
      row.trackTitle.toLowerCase().includes(needle) ||
      row.projectTitle.toLowerCase().includes(needle) ||
      row.artistName.toLowerCase().includes(needle)
    );
  });
}

function PickerTable({
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
  const [query, setQuery] = useState("");

  const filtered = useMemo(
    () => filterLibrary(library, query),
    [library, query],
  );

  if (library.length === 0) {
    return (
      <p className="px-6 py-10 text-center text-sm text-[rgb(var(--fg-secondary))]">
        Your music library is empty. Upload a track from a project first.
      </p>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* search */}
      <div className="border-b border-[rgb(var(--border-subtle))] px-5 py-4">
        <div className="flex items-center gap-2 rounded-full bg-[rgb(var(--bg-base))] px-3.5 py-2 ring-1 ring-[rgb(var(--border-subtle))] transition-[box-shadow] duration-200 ease-out focus-within:ring-[rgb(var(--brand-primary)/0.5)]">
          <svg
            viewBox="0 0 16 16"
            className="h-3.5 w-3.5 shrink-0 text-[rgb(var(--fg-muted))]"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <circle cx="7" cy="7" r="5" />
            <path d="m14 14-3-3" />
          </svg>
          <input
            type="search"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
            }}
            placeholder="Search by title, project, or artist…"
            aria-label="Search library"
            className="min-w-0 flex-1 bg-transparent text-sm text-[rgb(var(--fg-primary))] placeholder:text-[rgb(var(--fg-muted))] focus:outline-none"
            style={{ letterSpacing: "-0.005em" }}
          />
          {query ? (
            <button
              type="button"
              onClick={() => {
                setQuery("");
              }}
              aria-label="Clear search"
              className="grid h-5 w-5 shrink-0 place-items-center rounded-full text-[rgb(var(--fg-muted))] transition-colors duration-200 ease-out hover:bg-[rgb(var(--bg-overlay))] hover:text-[rgb(var(--fg-primary))]"
            >
              <svg viewBox="0 0 12 12" className="h-2.5 w-2.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                <path d="M3 3l6 6M9 3l-6 6" />
              </svg>
            </button>
          ) : null}
        </div>
      </div>

      {/* table */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <table className="w-full border-collapse">
          <thead className="sticky top-0 bg-[rgb(var(--bg-elevated))]">
            <tr className="border-b border-[rgb(var(--border-subtle))]">
              <th className="px-5 py-2.5 text-left font-mono text-[10px] font-medium uppercase tracking-[0.16em] text-[rgb(var(--fg-muted))]">
                Title
              </th>
              <th className="px-3 py-2.5 text-left font-mono text-[10px] font-medium uppercase tracking-[0.16em] text-[rgb(var(--fg-muted))]">
                Project
              </th>
              <th className="px-3 py-2.5 text-left font-mono text-[10px] font-medium uppercase tracking-[0.16em] text-[rgb(var(--fg-muted))]">
                Artist
              </th>
              <th className="px-3 py-2.5 text-left font-mono text-[10px] font-medium uppercase tracking-[0.16em] text-[rgb(var(--fg-muted))]">
                Uploaded
              </th>
              <th className="px-5 py-2.5 text-right font-mono text-[10px] font-medium uppercase tracking-[0.16em] text-[rgb(var(--fg-muted))]">
                <span className="sr-only">Action</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td
                  colSpan={5}
                  className="px-5 py-12 text-center font-mono text-[11px] uppercase tracking-[0.18em] text-[rgb(var(--fg-muted))]"
                >
                  NO SONGS MATCH “{query}”
                </td>
              </tr>
            ) : (
              filtered.map((row) => (
                <PickerRow
                  key={row.versionId}
                  row={row}
                  addedSet={addedSet}
                  pendingId={pendingId}
                  onPick={onPick}
                />
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PickerRow({
  row,
  addedSet,
  pendingId,
  onPick,
}: {
  row: LibraryPickRow;
  addedSet: Set<string>;
  pendingId: string | null;
  onPick: (row: LibraryPickRow) => void;
}): ReactNode {
  const alreadyAdded = row.audioUrl ? addedSet.has(row.audioUrl) : false;
  const noAudio = !row.audioUrl;
  const rowDisabled = noAudio || alreadyAdded;
  const pending = pendingId === row.versionId;
  const date = new Date(row.uploadedAt).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });

  const trigger = () => {
    if (rowDisabled || pending) return;
    onPick(row);
  };

  return (
    <tr
      onClick={trigger}
      className={[
        "border-b border-[rgb(var(--border-subtle)/0.6)] transition-colors duration-150 ease-out",
        rowDisabled || pending
          ? "cursor-not-allowed opacity-55"
          : "cursor-pointer hover:bg-[rgb(var(--bg-overlay))]",
      ].join(" ")}
    >
      <td
        className="px-5 py-3 text-[13px] text-[rgb(var(--fg-primary))]"
        style={{ fontWeight: 600, letterSpacing: "-0.005em" }}
      >
        <span className="block max-w-[200px] truncate">{row.trackTitle}</span>
      </td>
      <td className="px-3 py-3 text-[12.5px] text-[rgb(var(--fg-secondary))]">
        <span className="block max-w-[140px] truncate">{row.projectTitle}</span>
      </td>
      <td className="px-3 py-3 text-[12.5px] text-[rgb(var(--fg-secondary))]">
        <span className="block max-w-[120px] truncate">{row.artistName}</span>
      </td>
      <td className="px-3 py-3 font-mono text-[10.5px] uppercase tracking-[0.14em] text-[rgb(var(--fg-muted))] tabular-nums">
        {date}
      </td>
      <td className="px-5 py-3 text-right">
        {alreadyAdded ? (
          <span className="inline-flex items-center rounded-full bg-[rgb(var(--brand-primary)/0.12)] px-2.5 py-1 font-mono text-[9.5px] font-medium uppercase tracking-[0.16em] text-[rgb(var(--brand-primary))]">
            Added
          </span>
        ) : noAudio ? (
          <span className="inline-flex items-center rounded-full bg-[rgb(var(--fg-muted)/0.12)] px-2.5 py-1 font-mono text-[9.5px] font-medium uppercase tracking-[0.16em] text-[rgb(var(--fg-secondary))]">
            No audio
          </span>
        ) : (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              trigger();
            }}
            disabled={pending}
            className="inline-flex items-center gap-1 rounded-full bg-[rgb(var(--brand-primary))] px-3 py-1 text-[11px] font-medium text-[rgb(var(--fg-inverse))] transition-all duration-200 ease-out hover:bg-[rgb(var(--brand-primary)/0.92)] active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <span>{pending ? "Adding…" : "Add"}</span>
            <span aria-hidden="true" className="text-[12px]">
              +
            </span>
          </button>
        )}
      </td>
    </tr>
  );
}
