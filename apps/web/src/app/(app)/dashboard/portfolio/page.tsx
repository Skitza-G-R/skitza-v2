import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { appRouter } from "~/server/trpc/routers/_app";
import { AddTrackToggle, DeleteTrackButton } from "./track-form";

// Server Component. Auth & producer-existence are guaranteed by (app)/layout
// — but the tRPC caller still needs userId to resolve its producerProcedure.
export default async function PortfolioPage() {
  const { userId } = await auth();
  const caller = appRouter.createCaller({ userId });
  const tracks = await caller.portfolio.list();

  return (
    <main className="p-8 max-w-3xl mx-auto">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <Link
            href="/dashboard"
            className="text-sm text-[rgb(var(--fg-secondary))] hover:text-[rgb(var(--fg-primary))]"
          >
            &larr; Dashboard
          </Link>
          <h1 className="text-2xl font-semibold mt-1">Portfolio</h1>
        </div>
        <AddTrackToggle />
      </div>

      <span className="inline-block mb-4 rounded-full border border-[rgb(var(--border-subtle))] px-2 py-0.5 text-xs text-[rgb(var(--fg-secondary))]">
        Reorder coming soon
      </span>

      {tracks.length === 0 ? (
        <p className="text-[rgb(var(--fg-secondary))]">
          No tracks yet. Add your first one to start building your portfolio.
        </p>
      ) : (
        <ul className="space-y-3">
          {tracks.map((track) => (
            <li key={track.id}>
              <article className="flex items-start justify-between gap-4 rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-4">
                <div className="min-w-0">
                  <h2 className="font-medium text-[rgb(var(--fg-primary))] truncate">
                    {track.title}
                  </h2>
                  {track.artist && (
                    <p className="text-sm text-[rgb(var(--fg-secondary))] truncate">
                      {track.artist}
                    </p>
                  )}
                  <p className="mt-1 text-xs text-[rgb(var(--fg-secondary))] truncate">
                    {track.audioUrl}
                  </p>
                </div>
                <DeleteTrackButton trackId={track.id} />
              </article>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
