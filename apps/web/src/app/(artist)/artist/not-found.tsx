import Link from "next/link";

export default function ArtistNotFound() {
  return (
    <section
      aria-labelledby="artist-not-found-title"
      className="mx-auto max-w-lg rounded-[var(--radius-xl)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-5 py-7 text-center shadow-[var(--shadow-sm)]"
    >
      <p className="font-mono text-[10px] font-bold tracking-[0.16em] text-[rgb(var(--brand-primary-text))] uppercase">
        Not available
      </p>
      <h1
        id="artist-not-found-title"
        className="font-display mt-2 text-2xl font-extrabold tracking-[-0.025em] text-[rgb(var(--fg-default))]"
      >
        This item can’t be opened.
      </h1>
      <p className="mt-2 text-sm leading-relaxed text-[rgb(var(--fg-muted))]">
        It may have moved, expired, or no longer belong to this artist account.
      </p>
      <Link
        href="/artist"
        className="sk-press mt-5 inline-flex min-h-11 items-center justify-center rounded-[var(--radius-lg)] bg-[rgb(var(--brand-primary))] px-5 py-2.5 text-sm font-bold text-[rgb(var(--fg-default))]"
      >
        Back to artist home
      </Link>
    </section>
  );
}
