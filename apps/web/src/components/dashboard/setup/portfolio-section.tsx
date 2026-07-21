"use client";

// Producer's public portfolio list — Profile → Portfolio tab and the
// legacy Setup page consume this same component.
//
// Every row is a real song marked public by its producer. The legacy copied
// portfolio title/audio row is no longer an authority.
//
// State model:
//   * `rows`: optimistic copy of `tracks` prop. Synced via useEffect
//     when the parent re-fetches (F9 picker -> router.refresh ->
//     fresh tracks prop). Sibling ExternalLinksSection follows the
//     same pattern.
//   * `editingId`: the row currently in inline edit mode, or null.
//   * `removingId`: the row in the middle of a delete round-trip.

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { useToast } from "~/components/ui/toast";
import { setPortfolioSongPublished } from "~/app/(producer)/dashboard/portfolio/actions";

export type PortfolioTrackRow = {
  id: string;
  title: string;
  artist: string | null;
};

export function PortfolioSection({ tracks }: { tracks: PortfolioTrackRow[] }) {
  const [rows, setRows] = useState<PortfolioTrackRow[]>(tracks);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const router = useRouter();
  const { toast } = useToast();

  // Sync rows when the parent re-fetches tracks (F9 "Add from music
  // library" picker calls router.refresh on success → server re-runs
  // the page query → fresh tracks array via props). Without this,
  // useState's initial value freezes the list and new tracks (or
  // edits/removes from another tab) wouldn't appear until a hard
  // browser refresh remounts the component.
  useEffect(() => {
    setRows(tracks);
  }, [tracks]);

  function remove(t: PortfolioTrackRow) {
    if (typeof window !== "undefined") {
      const confirmed = window.confirm(`Remove "${t.title}" from your public portfolio?`);
      if (!confirmed) return;
    }
    setRemovingId(t.id);
    setRows((all) => all.filter((r) => r.id !== t.id));
    startTransition(async () => {
      const res = await setPortfolioSongPublished({
        trackId: t.id,
        operationKey: crypto.randomUUID(),
        published: false,
      });
      setRemovingId(null);
      if (!res.ok) {
        toast(res.error, "error");
        setRows(tracks);
        return;
      }
      router.refresh();
    });
  }

  return (
    <section>
      {rows.length === 0 ? (
        <PortfolioEmpty />
      ) : (
        <ul className="divide-y divide-[rgb(var(--border-subtle))]">
          {rows.map((t) => (
            <TrackRow
              key={t.id}
              track={t}
              pendingRemove={removingId === t.id}
              onRemove={() => {
                remove(t);
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

function TrackRow({
  track,
  pendingRemove,
  onRemove,
}: {
  track: PortfolioTrackRow;
  pendingRemove: boolean;
  onRemove: () => void;
}) {
  return (
    <li className="flex flex-wrap items-start justify-between gap-4 py-4 first:pt-0 last:pb-0">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm text-[rgb(var(--fg-primary))]" style={{ fontWeight: 600 }}>
          {track.title}
        </p>
        {track.artist ? (
          <p className="mt-1 truncate text-xs text-[rgb(var(--fg-secondary))]">{track.artist}</p>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <button
          type="button"
          onClick={onRemove}
          disabled={pendingRemove}
          className="inline-flex h-8 items-center rounded-[var(--radius-sm)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-base))] px-3 text-xs font-medium text-[rgb(var(--fg-secondary))] transition-colors hover:border-[rgb(var(--border-strong))] hover:text-[rgb(var(--fg-primary))] focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))] focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pendingRemove ? "Removing…" : "Remove"}
        </button>
      </div>
    </li>
  );
}
