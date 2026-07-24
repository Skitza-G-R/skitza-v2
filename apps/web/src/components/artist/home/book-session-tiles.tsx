"use client";

import { OnlineRequiredLink } from "~/components/runtime-state/online-required-link";
import { withArtistStudio } from "~/lib/artist-studio-context";

import { useArtistHomeRuntime } from "./artist-home-runtime";
import { ProducerArt } from "./producer-art";

export type BookSessionTilesProps = {
  studios: Array<{
    producerId: string;
    producerName: string;
    producerSlug: string;
  }>;
  activeStudioId?: string | null;
};

export function BookSessionTiles({ studios, activeStudioId }: BookSessionTilesProps) {
  const runtime = useArtistHomeRuntime();
  const restoredStudios = runtime?.view.studios ?? studios;

  return (
    <section aria-labelledby="book-session-heading">
      <header className="flex items-baseline justify-between border-b border-[rgb(var(--border-subtle))] pb-2">
        <div className="flex items-baseline gap-3">
          <h2
            id="book-session-heading"
            className="text-[14px] font-bold text-[rgb(var(--fg-default))]"
            style={{ fontFamily: "var(--font-syne)", letterSpacing: "-0.01em" }}
          >
            Book a session
          </h2>
          <span
            className="text-[10.5px] tracking-[0.04em] text-[rgb(var(--fg-muted))] uppercase"
            style={{ fontFamily: "var(--font-jetbrains-mono)" }}
          >
            {restoredStudios.length} IN ROSTER
          </span>
        </div>
        <OnlineRequiredLink
          href={withArtistStudio("/artist/book", activeStudioId)}
          className="text-[12px] font-medium text-[rgb(var(--fg-muted))] transition-colors hover:text-[rgb(var(--fg-default))]"
          offlineMessage="Reconnect to browse booking times."
        >
          Browse all →
        </OnlineRequiredLink>
      </header>
      {restoredStudios.length === 0 ? (
        <EmptyState />
      ) : (
        <ul className="mt-3 grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4">
          {restoredStudios.map((s) => (
            <li key={s.producerId}>
              <OnlineRequiredLink
                href={withArtistStudio("/artist/book", s.producerId)}
                className="flex items-center gap-2.5 rounded-[10px] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-2 transition-colors hover:bg-[rgb(var(--bg-background))]"
                offlineMessage="Reconnect to book this studio."
              >
                <ProducerArt producerName={s.producerName} size={44} initialsFontSize={14} />
                <span className="truncate text-[12.5px] font-semibold text-[rgb(var(--fg-default))]">
                  {s.producerName}
                </span>
              </OnlineRequiredLink>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function EmptyState() {
  return (
    <OnlineRequiredLink
      href="/artist/book"
      className="mt-3 flex items-center justify-center rounded-[10px] border border-dashed border-[rgb(var(--border-subtle))] px-4 py-6 text-[13px] font-semibold text-[rgb(var(--fg-muted))] transition-colors hover:bg-[rgb(var(--bg-background))]"
      offlineMessage="Reconnect to find a studio."
    >
      Find a studio →
    </OnlineRequiredLink>
  );
}
