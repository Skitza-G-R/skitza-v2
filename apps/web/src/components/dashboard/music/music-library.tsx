"use client";

import Link from "next/link";
import { useMemo } from "react";

import { EmptyState } from "~/components/ui/empty-state";
import {
  ListSearchInput,
  listSearchMatches,
  useListSearch,
} from "~/components/ui/list-search";
import { fmtDateTime, formatRelativeTime } from "~/lib/time/relative";

// Minimal row shape the list renders. Mirrors the server router's
// response shape but converts Date → ISO string so we stay on the
// plain-JSON side of the RSC → client boundary. The server page
// (page.tsx) does the .toISOString() conversion.
export type MusicRow = {
  id: string;
  trackTitle: string;
  label: string;
  projectId: string;
  projectTitle: string;
  clientName: string | null;
  uploadedAtIso: string;
  audioUrl: string | null;
};

// Batch C — Music library is now a Spotify-style tactile grid of
// cover-art cards instead of a text list. Each card shows:
//   • Generated "cover art" at top — a procedural gradient keyed on
//     the track id hash (stable per track, visually distinct across
//     the grid). A faint waveform silhouette overlays the gradient so
//     the card still reads as a music asset, not just a color block.
//   • Track title, bold (display font, tight tracking).
//   • Project / artist line, muted.
//   • Hover: play-triangle chip animates in over the cover.
//
// Responsive columns: 2 cols mobile → 3 @sm → 4 @md → 5 @lg → 6 @xl.
// Gap scales with viewport (tight on mobile, generous on desktop).
//
// Click target = whole card; deep-links into the Project Room's Music
// sub-tab with ?version=<id> so the producer lands on that exact mix.
export function MusicLibrary({ tracks }: { tracks: MusicRow[] }) {
  const { value: q, setValue: setQ, inputRef } = useListSearch();

  // Filter tracks by title / project / artist / label — all of which a
  // producer is likely to remember. Cheap in-memory filter; the Music
  // grid is a single page of results (server already paginates), so
  // no server round-trip is warranted.
  const filteredTracks = useMemo(
    () =>
      tracks.filter((row) =>
        listSearchMatches(q, [row.trackTitle, row.projectTitle, row.clientName, row.label]),
      ),
    [tracks, q],
  );

  if (tracks.length === 0) {
    return <MusicLibraryEmpty />;
  }

  return (
    <div className="mt-6">
      <div className="mb-5 sm:max-w-xs">
        <ListSearchInput
          value={q}
          onChange={setQ}
          inputRef={inputRef}
          placeholder="Search music"
          ariaLabel="Search music library"
        />
      </div>
      {filteredTracks.length === 0 ? (
        <div
          role="status"
          className="rounded-[var(--radius-md)] border border-dashed border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-sunken))] p-6 text-center text-sm text-[rgb(var(--fg-secondary))]"
        >
          No tracks match “{q}”.
        </div>
      ) : (
        <ul
          role="list"
          className="grid grid-cols-2 gap-4 sm:grid-cols-3 sm:gap-5 md:grid-cols-4 md:gap-6 lg:grid-cols-5 xl:grid-cols-6"
        >
          {filteredTracks.map((row, i) => (
            <MusicCard key={row.id} row={row} index={i} />
          ))}
        </ul>
      )}
    </div>
  );
}

// ─── Empty state ─────────────────────────────────────────────────────

// Extracted as a named function so unit tests can render it without a
// route. Design-doc copy: prompt producers with the drop-zone hint
// rather than a dry "no data" — a fresh producer needs to know that
// the path to their first track is through any project, not here.
export function MusicLibraryEmpty() {
  return (
    <EmptyState
      className="mt-10"
      icon={<WaveformIcon />}
      title="No audio yet"
      description="Drop a WAV into any project to kick things off. Uploads land here once your first track has a version."
      action={
        <Link
          href="/dashboard/projects"
          className="inline-flex h-10 items-center rounded-[var(--radius-md)] bg-[rgb(var(--brand-primary))] px-4 text-sm font-medium text-[rgb(var(--fg-inverse))] hover:brightness-110"
        >
          Open Projects
        </Link>
      }
    />
  );
}

// ─── Card ────────────────────────────────────────────────────────────

function MusicCard({ row, index }: { row: MusicRow; index: number }) {
  const uploadedAt = new Date(row.uploadedAtIso);
  // The Project Room page reads ?tab=music + ?version=<id> off
  // searchParams — our Music sub-tab pre-selects the version via that
  // URL param, so deep-linking here lands the producer on the exact
  // waveform they tapped.
  const href = `/dashboard/projects/${row.projectId}?tab=music&version=${row.id}`;

  // "Artist EP · Alice Records" — fall back to just the title when the
  // project has no client name (legacy rows + producer-as-artist setups).
  const projectLine = row.clientName
    ? `${row.projectTitle} · ${row.clientName}`
    : row.projectTitle;

  return (
    <li
      className="sk-stagger-item"
      style={{ ["--i" as string]: String(index) } as React.CSSProperties}
    >
      <Link
        href={href}
        className="sk-lift group flex flex-col gap-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))] focus-visible:ring-offset-2 focus-visible:ring-offset-[rgb(var(--bg-base))]"
      >
        <CoverArt trackId={row.id} title={row.trackTitle} />
        <div className="min-w-0">
          <p className="truncate font-display text-base font-semibold leading-tight tracking-tight text-[rgb(var(--fg-primary))]">
            {row.trackTitle}
          </p>
          <p className="mt-1 truncate text-xs text-[rgb(var(--fg-secondary))]">
            {projectLine}
          </p>
          <div className="mt-1 flex items-center gap-2">
            <span className="font-mono text-[0.62rem] uppercase tracking-[0.14em] text-[rgb(var(--fg-muted))]">
              {row.label}
            </span>
            <span
              className="sk-num font-mono text-[0.62rem] text-[rgb(var(--fg-muted))]"
              title={fmtDateTime(uploadedAt)}
            >
              · {formatRelativeTime(uploadedAt)}
            </span>
          </div>
        </div>
      </Link>
    </li>
  );
}

// ─── Cover art ───────────────────────────────────────────────────────

// Generated cover art. Samply / Spotify lean on real artwork, but we
// don't have uploaded covers yet — so we produce one procedurally from
// the track id. The result is visually stable (same id → same cover)
// and distinct across the grid, giving the library a tactile,
// "record-sleeve" feel rather than text-only rows.
//
// Design:
//   • Square aspect via padding-top:100% on the wrapper.
//   • Two-stop linear gradient keyed on a hash of the id, rotated at
//     a hash-derived angle. Colors come from the brand palette (amber
//     + copper with varying alpha) so the grid keeps its brand voice.
//   • Waveform silhouette overlay — 5 vertical bars in the foreground
//     at varying heights, also hash-derived, so the cover still reads
//     as "this is music" at a glance.
//   • Hover: a round play-triangle chip rises in the bottom-right
//     corner (Spotify-style), brand-primary with a subtle glow.
function CoverArt({ trackId, title }: { trackId: string; title: string }) {
  const hash = hashString(trackId);
  // Two hue tweaks (in 0..1 space) used to mix the amber/copper stops.
  // Keeps colors in-palette (no random rainbows) but differentiated.
  const hueA = (hash % 60) / 360;
  const hueB = ((hash >> 4) % 60) / 360;
  const angle = (hash >> 8) % 360;
  // Waveform bar heights — 7 bars, each between 30-90% of card height.
  const bars = Array.from({ length: 7 }, (_, i) => {
    const seed = (hash >> (i * 3)) & 0x3f;
    return 30 + (seed % 60);
  });

  return (
    <div
      aria-hidden
      className="relative w-full overflow-hidden rounded-[var(--radius-lg)] shadow-[var(--shadow-sm)] transition-shadow group-hover:shadow-[var(--shadow-md)]"
      style={{
        paddingTop: "100%",
        background: `linear-gradient(${String(angle)}deg,
          rgb(var(--brand-primary) / ${String(0.7 + hueA * 0.3)}),
          rgb(var(--brand-accent) / ${String(0.6 + hueB * 0.3)}))`,
      }}
    >
      {/* Waveform silhouette — absolute-positioned, spans the lower
          half so the upper half still reads as open sky for brand. */}
      <div
        aria-label={`Cover art for ${title}`}
        className="absolute inset-x-4 bottom-4 flex items-end justify-between gap-1"
        style={{ height: "40%" }}
      >
        {bars.map((h, i) => (
          <span
            key={i}
            className="flex-1 rounded-sm bg-[rgb(255_255_255_/_0.55)]"
            style={{ height: `${String(h)}%` }}
          />
        ))}
      </div>
      {/* Subtle inner shadow so the card has a tactile edge even on
          the cream background. Doesn't interfere with the gradient. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 rounded-[var(--radius-lg)] shadow-[inset_0_1px_0_0_rgb(255_255_255_/_0.25),inset_0_-1px_0_0_rgb(0_0_0_/_0.08)]"
      />
      {/* Play chip — hidden by default, fades + lifts in on hover.
          Reduced-motion users see it with no motion (opacity flips
          instantly). */}
      <span
        className="absolute bottom-3 right-3 flex h-11 w-11 items-center justify-center rounded-full bg-[rgb(var(--brand-primary))] text-[rgb(var(--fg-inverse))] opacity-0 shadow-[var(--shadow-md)] transition-[opacity,transform] duration-200 group-hover:opacity-100 motion-safe:translate-y-1 motion-safe:group-hover:translate-y-0 motion-safe:group-focus-visible:opacity-100 motion-safe:group-focus-visible:translate-y-0"
      >
        <svg width="14" height="14" viewBox="0 0 12 12" fill="currentColor" aria-hidden>
          <path d="M3.5 2.5v7l6-3.5-6-3.5Z" />
        </svg>
      </span>
    </div>
  );
}

// Simple 32-bit FNV-1a — deterministic, spreads well, and we only
// need a handful of bits. Avoids pulling in a hash lib for cover art.
function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

// ─── Icons ───────────────────────────────────────────────────────────

function WaveformIcon() {
  return (
    <svg
      aria-hidden
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 14V10" />
      <path d="M8 18V6" />
      <path d="M12 16V8" />
      <path d="M16 19V5" />
      <path d="M20 14V10" />
    </svg>
  );
}
