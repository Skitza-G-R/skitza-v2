import Link from "next/link";

import { ProducerArt } from "./producer-art";

export type BookSessionTilesProps = {
  studios: Array<{
    producerId: string;
    producerName: string;
    producerSlug: string;
  }>;
};

export function BookSessionTiles({ studios }: BookSessionTilesProps) {
  return (
    <section aria-labelledby="book-session-heading">
      <header className="flex items-baseline justify-between border-b border-[var(--border-subtle)] pb-2">
        <div className="flex items-baseline gap-3">
          <h2
            id="book-session-heading"
            className="text-[14px] font-bold text-[var(--fg-default)]"
            style={{ fontFamily: "var(--font-syne)", letterSpacing: "-0.01em" }}
          >
            Book a session
          </h2>
          <span
            className="uppercase text-[10.5px] tracking-[0.04em] text-[var(--fg-muted)]"
            style={{ fontFamily: "var(--font-jetbrains-mono)" }}
          >
            {studios.length} IN ROSTER
          </span>
        </div>
        <Link
          href="/artist/book"
          className="text-[12px] font-medium text-[var(--fg-muted)] transition-colors hover:text-[var(--fg-default)]"
        >
          Browse all →
        </Link>
      </header>
      {studios.length === 0 ? (
        <EmptyState />
      ) : (
        <ul className="mt-3 grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4">
          {studios.map((s) => (
            <li key={s.producerId}>
              <Link
                href={`/artist/book?producerId=${s.producerId}`}
                className="flex items-center gap-2.5 rounded-[10px] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-2 transition-colors hover:bg-[var(--bg-background)]"
              >
                <ProducerArt
                  producerName={s.producerName}
                  size={44}
                  initialsFontSize={14}
                />
                <span className="truncate text-[12.5px] font-semibold text-[var(--fg-default)]">
                  {s.producerName}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function EmptyState() {
  return (
    <Link
      href="/artist/book"
      className="mt-3 flex items-center justify-center rounded-[10px] border border-dashed border-[var(--border-subtle)] px-4 py-6 text-[13px] font-semibold text-[var(--fg-muted)] transition-colors hover:bg-[var(--bg-background)]"
    >
      Find a studio →
    </Link>
  );
}
