import { RecentUploadCard } from "./recent-upload-card";
import type { PlayerTrack } from "../../audio/persistent-player";
import type { RecentUpload } from "../../../server/trpc/routers/producer";

// Studio · Recent uploads — the horizontal cover-art shelf on the
// redesigned Today dashboard (Story 3 of the today-redesign epic).
//
// State machine (uploads.length):
//   0           → render nothing (silence > "no tracks yet" copy)
//   1..4        → sparse: left-aligned cards, no scroll affordance
//   5..7        → full: first 5 visible, rest scroll into view via
//                 sk-scroll-x; trailing "View all in Music →" link
//                 to the deep Music page
//
// The component is a pure presentational shell — all data fetching
// happens upstream in the producer.today fan-out (Story 1 added the
// recentUploads leg). Card-level interactions (play, deep-link,
// badge) live in RecentUploadCard.
//
// Render-decision logic is split into a pure helper (shelfRenderModel)
// so tests can pin the empty/sparse/full transitions without going
// through React. See __tests__/recent-uploads-shelf.test.tsx for the
// full matrix.

interface RecentUploadsShelfProps {
  uploads: RecentUpload[];
}

// Maximum number of cards visible without horizontal scrolling. Cards
// 6 + 7 are reachable via the sk-scroll-x rail; the View-all link is
// added at index 6 in render order so it always reads as a bookend.
const MAX_VISIBLE_CARDS = 5;

interface ShelfRenderModel {
  render: boolean;
  visibleCards: RecentUpload[];
  showViewAll: boolean;
}

export const EMPTY_SHELF_RESULT: ShelfRenderModel = {
  render: false,
  visibleCards: [],
  showViewAll: false,
};

export function shelfRenderModel(uploads: RecentUpload[]): ShelfRenderModel {
  if (uploads.length === 0) return EMPTY_SHELF_RESULT;
  return {
    render: true,
    visibleCards: uploads.slice(0, MAX_VISIBLE_CARDS),
    showViewAll: uploads.length > MAX_VISIBLE_CARDS,
  };
}

// Click target — clicking the card body navigates here. `?tab=music`
// keeps the project room on its Music sub-tab; `?versionId=` lets
// the music tab pre-select that version on mount.
export function cardHref(u: RecentUpload): string {
  return `/dashboard/projects/${u.projectId}?tab=music&versionId=${u.versionId}`;
}

// CustomEvent payload dispatched on play-button click. Shape matches
// the existing PersistentPlayer's PlayerTrack (apps/web/src/components/
// audio/persistent-player.tsx) so we plug into the existing event bus
// instead of inventing a parallel one. The persistent player listens
// on `skitza:player:set`.
//
// `subtitle` follows the in-app convention: "Project · Version" reads
// better than "Version · Project" when the player ticker is narrow
// (the version label is short enough to fit when truncation kicks in).
export function cardPlayDetail(u: RecentUpload): PlayerTrack {
  return {
    id: u.versionId,
    audioUrl: u.audioUrl,
    title: u.title,
    subtitle: `${u.projectClientName} · ${u.versionLabel}`,
    durationMs: u.durationMs,
  };
}

// Badge digit text. Returns null when the badge should not render
// (zero or negative — the latter is defensive against malformed
// payloads). Caps at "99+" to keep the badge a fixed visual width.
export function badgeText(unread: number): string | null {
  if (!Number.isFinite(unread) || unread <= 0) return null;
  if (unread > 99) return "99+";
  return String(unread);
}

export function RecentUploadsShelf({ uploads }: RecentUploadsShelfProps) {
  const model = shelfRenderModel(uploads);
  if (!model.render) return null;

  return (
    <section
      aria-labelledby="recent-uploads-heading"
      data-tour-id="recent-uploads"
    >
      {/* Section eyebrow + heading — section spacing owned by the
          page-level `space-y-12` wrapper. */}
      <div className="mb-4">
        <p className="font-mono text-[0.66rem] uppercase tracking-[0.2em] text-[rgb(var(--fg-muted))]">
          Studio · Recent uploads
        </p>
        <h2
          id="recent-uploads-heading"
          className="mt-1 font-display text-2xl tracking-tight text-[rgb(var(--fg-primary))]"
        >
          Recent uploads
        </h2>
      </div>

      <div className="sk-scroll-x flex gap-4 overflow-x-auto pb-1">
        {model.visibleCards.map((u) => (
          <RecentUploadCard key={u.versionId} upload={u} />
        ))}
        {model.showViewAll && <ViewAllCard />}
      </div>
    </section>
  );
}

// Trailing card slot at the end of the rail. Same 144×144 footprint
// as the cover cards so the row reads as a unified shelf, with a
// muted border + plain-text label rather than a gradient. Clicks
// through to the dedicated Music page where the producer can browse
// all uploads with filters + a richer waveform list.
function ViewAllCard() {
  return (
    <a
      href="/dashboard/music"
      className="group flex w-36 shrink-0 flex-col gap-2"
    >
      <div
        // Solid border (was dashed). Dashed reads as "drop zone" or
        // "empty state" — per UX-critic on PR #48, "View all" is the
        // opposite signal: more content available. Solid + bg-elevated
        // matches the rail's neighbouring cover-art cards visually.
        className="flex h-36 w-36 items-center justify-center rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] text-sm font-medium text-[rgb(var(--fg-secondary))] transition-colors group-hover:border-[rgb(var(--brand-primary))] group-hover:text-[rgb(var(--brand-primary))]"
        aria-hidden
      >
        <span className="px-3 text-center leading-tight">View all in Music →</span>
      </div>
      <span className="sr-only">View all uploads in Music</span>
    </a>
  );
}
