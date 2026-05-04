"use client";

// Story 01 of /join flow — Setup → Portfolio tab inline UI.
//
// Per PRD §6.2, the producer flags up to 3 tracks as "public samples"
// for unsigned-in visitors on `/join/<slug>`. This section renders
// the producer's tracklist with a per-track toggle; flipping the
// toggle is optimistic (switch flips instantly, rolls back on error)
// and calls the `portfolio.togglePublicSample` mutation via a server
// action.
//
// Empty state is intentional — it tells the producer upload happens
// elsewhere (the public portfolio workflow). This is Wave 1 scope;
// the full upload + reorder UI is tracked in the Setup rehost
// follow-up noted on `settings/page.tsx`.

import { useEffect, useState, useTransition } from "react";

import { SaveIndicator, useSaveStatus } from "~/components/ui/save-indicator";
import { useToast } from "~/components/ui/toast";
import { togglePublicSample } from "~/app/(producer)/dashboard/settings/actions";

export type PortfolioTrackRow = {
  id: string;
  title: string;
  artist: string | null;
  isPublicSample: boolean;
};

export function PortfolioSection({ tracks }: { tracks: PortfolioTrackRow[] }) {
  // Local optimistic copy of the server state. `useState` (not
  // `useOptimistic`) because the mutation is fire-and-forget server
  // action — no pending UI, just instant-flip + rollback-on-error.
  const [rows, setRows] = useState<PortfolioTrackRow[]>(tracks);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [lastSavedId, setLastSavedId] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const { toast } = useToast();

  // Sync rows when the parent re-fetches tracks (e.g. F9 "Add from
  // music library" flow calls router.refresh after a successful pick;
  // server re-runs the page query and a new `tracks` array arrives via
  // props). Without this, useState's initial value would freeze the
  // list and the new track wouldn't appear until a hard browser
  // refresh remounts the component. Mirrors the same pattern in
  // ExternalLinksSection below. Safe for the optimistic toggle flow:
  // togglePublicSample doesn't call router.refresh, so the tracks
  // prop identity is stable during a flip and this effect doesn't
  // clobber the in-flight optimistic state.
  useEffect(() => {
    setRows(tracks);
  }, [tracks]);

  // Count flagged tracks so the producer sees live progress against
  // the cap. The PRD says "up to 3" but enforcement happens at query
  // time on `/join/<slug>` (sort DESC, limit 3). Here we just show
  // the count — no hard cap at UI level, producers can flag more
  // and the teaser shows the 3 most recent.
  const flaggedCount = rows.filter((r) => r.isPublicSample).length;

  function flip(id: string) {
    const prev = rows.find((r) => r.id === id);
    if (!prev) return;
    const next = !prev.isPublicSample;
    setRows((all) => all.map((r) => (r.id === id ? { ...r, isPublicSample: next } : r)));
    setPendingId(id);
    setLastSavedId(id);
    startTransition(async () => {
      const res = await togglePublicSample({ trackId: id, enabled: next });
      setPendingId(null);
      if (!res.ok) {
        // Roll back the optimistic flip — producer sees the switch
        // snap back to its server-truth position, paired with the
        // toast below.
        setRows((all) =>
          all.map((r) => (r.id === id ? { ...r, isPublicSample: prev.isPublicSample } : r)),
        );
        setLastSavedId(null);
        toast(res.error, "error");
      }
    });
  }

  return (
    <section>
      {/* Page-level header (settings/page.tsx) hosts the section title
          + description; this section sits flat inside the outer Setup
          container card. We keep the live "% public" counter — it's
          data, not header. */}
      {rows.length > 0 ? (
        <p className="mb-3 font-mono text-[0.66rem] uppercase tracking-[0.16em] text-[rgb(var(--fg-muted))]">
          {flaggedCount} / {rows.length} public
        </p>
      ) : null}

      {rows.length === 0 ? (
        <PortfolioEmpty />
      ) : (
        <ul className="divide-y divide-[rgb(var(--border-subtle))]">
          {rows.map((t) => (
            <TrackRow
              key={t.id}
              id={t.id}
              title={t.title}
              artist={t.artist}
              enabled={t.isPublicSample}
              pending={pendingId === t.id}
              recentlySaved={lastSavedId === t.id}
              onToggle={() => {
                flip(t.id);
              }}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function PortfolioEmpty() {
  return (
    <div
      role="status"
      className="rounded-[var(--radius-md)] border border-dashed border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-sunken))] p-6 text-center text-sm text-[rgb(var(--fg-secondary))]"
    >
      You haven&rsquo;t uploaded any portfolio tracks yet.
    </div>
  );
}

// Per-track row. Mirrors ToggleRow in autopilot-section — same min-
// height, same switch geometry, same recently-saved chip behavior —
// so the two Setup tabs feel like siblings. Focus ring uses brand
// primary with a bg-elevated offset so the switch is always
// visible on the card surface.
function TrackRow({
  id,
  title,
  artist,
  enabled,
  pending,
  recentlySaved,
  onToggle,
}: {
  id: string;
  title: string;
  artist: string | null;
  enabled: boolean;
  pending: boolean;
  recentlySaved: boolean;
  onToggle: () => void;
}) {
  const saveStatus = useSaveStatus({ saving: pending, error: null });
  return (
    <li className="flex flex-wrap items-start justify-between gap-4 py-4 first:pt-0 last:pb-0">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-3">
          <p
            className="truncate text-sm text-[rgb(var(--fg-primary))]"
            style={{ fontWeight: 600 }}
          >
            {title}
          </p>
          {recentlySaved ? <SaveIndicator status={saveStatus} /> : null}
        </div>
        {artist ? (
          <p className="mt-1 truncate text-xs text-[rgb(var(--fg-secondary))]">
            {artist}
          </p>
        ) : null}
      </div>
      <label
        htmlFor={`portfolio-public-${id}`}
        className="flex shrink-0 items-center gap-3 text-xs font-mono uppercase tracking-[0.14em] text-[rgb(var(--fg-secondary))]"
      >
        Public sample
        <button
          id={`portfolio-public-${id}`}
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-label={`Public sample for ${title}`}
          disabled={pending}
          onClick={onToggle}
          className={[
            "relative inline-flex h-7 w-12 flex-shrink-0 items-center rounded-full transition-colors",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-[rgb(var(--bg-elevated))] focus-visible:ring-[rgb(var(--brand-primary))]",
            enabled
              ? "bg-[rgb(var(--brand-primary))]"
              : "bg-[rgb(var(--fg-muted)/0.3)]",
            pending ? "opacity-60" : "",
          ].join(" ")}
        >
          <span
            aria-hidden
            className={[
              "inline-block h-5 w-5 transform rounded-full bg-white shadow-sm transition-transform",
              enabled ? "translate-x-6" : "translate-x-1",
            ].join(" ")}
          />
        </button>
      </label>
    </li>
  );
}
