import { auth } from "@clerk/nextjs/server";
import Link from "next/link";
import { appRouter } from "~/server/trpc/routers/_app";
import { AppShell } from "~/components/shell/app-shell";
import { EmptyState } from "~/components/ui/empty-state";
import { PortfolioToolbar, DeleteTrackButton, ReorderButtons } from "./track-form";
import { createDb, eq, producers } from "@skitza/db";

// Server Component. Auth & producer-existence are guaranteed by (app)/layout
// — but the tRPC caller still needs userId to resolve its producerProcedure.
export default async function PortfolioPage() {
  const { userId } = await auth();
  const caller = appRouter.createCaller({ userId });
  const tracks = await caller.portfolio.list();

  // Grab the producer's slug for the "view public portfolio" quick link.
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) throw new Error("missing DATABASE_URL");
  const db = createDb(dbUrl);
  const [row] = userId
    ? await db.select({ slug: producers.slug }).from(producers).where(eq(producers.clerkUserId, userId)).limit(1)
    : [];
  const slug = row?.slug;

  return (
    <AppShell active="setup">
      <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6 sm:py-14">
        <header className="reveal-up flex flex-wrap items-end justify-between gap-6">
          <div>
            <p className="font-mono text-[0.72rem] uppercase tracking-[0.18em] text-[rgb(var(--fg-muted))]">
              Portfolio
            </p>
            <h1
              className="mt-2 font-display text-4xl leading-tight tracking-tight sm:text-5xl"
              style={{ fontVariationSettings: '"opsz" 96' }}
            >
              Your tracklist.
            </h1>
            <p className="mt-3 max-w-lg text-sm text-[rgb(var(--fg-secondary))]">
              These play on your public page. Add the ones you want leads to hear first.
            </p>
          </div>
          <div className="flex items-center gap-3">
            {slug ? (
              <Link
                href={`/p/${slug}`}
                target="_blank"
                className="font-mono text-xs text-[rgb(var(--fg-secondary))] underline-offset-4 hover:text-[rgb(var(--brand-primary))] hover:underline"
              >
                View public →
              </Link>
            ) : null}
            <PortfolioToolbar />
          </div>
        </header>

        <div className="mt-3 flex items-center gap-2">
          <span className="font-mono text-xs text-[rgb(var(--fg-muted))]">
            {tracks.length} track{tracks.length === 1 ? "" : "s"}
          </span>
          {tracks.length > 1 ? (
            <span className="font-mono text-xs text-[rgb(var(--fg-muted))]">
              · reorder with the arrows
            </span>
          ) : null}
        </div>

        <section className="mt-8">
          {tracks.length === 0 ? (
            <EmptyState
              icon={<AudioIcon />}
              title="No tracks yet."
              description="Your portfolio is what clients see on your public page. Drop a track to feature your work — MP3, WAV, and a bit of artwork is all it takes."
              className="min-h-[60vh] justify-center"
            />
          ) : (
            <ol className="space-y-3">
              {tracks.map((track, idx) => (
                <li key={track.id} className="reveal-up">
                  <article className="group relative flex items-start gap-4 rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-4 transition-all duration-150 hover:border-[rgb(var(--border-strong))] hover:shadow-[var(--shadow-md)]">
                    {/* Track number, editorial-style. */}
                    <span className="shrink-0 pt-1 font-mono text-[0.72rem] tracking-widest text-[rgb(var(--fg-muted))]">
                      {String(idx + 1).padStart(2, "0")}
                    </span>
                    {/* Artwork. If missing, show a gradient tile. */}
                    <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))]">
                      {track.artworkUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={track.artworkUrl}
                          alt=""
                          className="h-full w-full object-cover"
                          loading="lazy"
                        />
                      ) : (
                        <div
                          aria-hidden
                          className="h-full w-full bg-gradient-to-br from-[rgb(var(--brand-primary)/0.5)] to-[rgb(var(--brand-accent)/0.4)]"
                        />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <h2 className="font-display text-xl leading-tight text-[rgb(var(--fg-primary))] line-clamp-1">
                        {track.title}
                      </h2>
                      {track.artist ? (
                        <p className="text-sm text-[rgb(var(--fg-secondary))] line-clamp-1">
                          {track.artist}
                        </p>
                      ) : null}
                      <p className="mt-2 font-mono text-[0.7rem] text-[rgb(var(--fg-muted))] line-clamp-1">
                        {track.audioUrl ?? "— processing"}
                      </p>
                    </div>
                    {tracks.length > 1 ? (
                      <ReorderButtons trackId={track.id} orderedIds={tracks.map((t) => t.id)} />
                    ) : null}
                    <DeleteTrackButton trackId={track.id} />
                  </article>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>
    </AppShell>
  );
}

function AudioIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M9 18V6l12-2v12" />
      <circle cx="6" cy="18" r="3" />
      <circle cx="18" cy="16" r="3" />
    </svg>
  );
}
