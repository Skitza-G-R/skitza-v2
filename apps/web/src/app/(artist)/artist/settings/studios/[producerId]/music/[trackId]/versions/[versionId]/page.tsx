import { auth } from "@clerk/nextjs/server";
import { TRPCError } from "@trpc/server";
import { Download, FileMusic } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { PastStudioRecordShell } from "~/components/artist/settings/past-studio-record-shell";
import { appRouter } from "~/server/trpc/routers/_app";

type PageProps = {
  params: Promise<{ producerId: string; trackId: string; versionId: string }>;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const metadata: Metadata = { title: "Past studio music" };

function dateLabel(value: Date): string {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(value);
}

function durationLabel(durationMs: number | null): string {
  if (durationMs === null || durationMs < 0) return "Duration unavailable";
  const totalSeconds = Math.round(durationMs / 1_000);
  const minutes = Math.floor(totalSeconds / 60);
  return `${String(minutes)}:${String(totalSeconds % 60).padStart(2, "0")}`;
}

function timestampLabel(timestampMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(timestampMs / 1_000));
  return `${String(Math.floor(totalSeconds / 60))}:${String(totalSeconds % 60).padStart(
    2,
    "0",
  )}`;
}

export default async function ArtistPastStudioVersionPage({ params }: PageProps) {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");
  const { producerId, trackId, versionId } = await params;
  if (![producerId, trackId, versionId].every((value) => UUID.test(value))) notFound();

  let data;
  try {
    data = await appRouter
      .createCaller({ userId })
      .artistPlatform.history.version({ producerId, versionId });
  } catch (error) {
    if (error instanceof TRPCError && error.code === "NOT_FOUND") notFound();
    throw error;
  }
  if (data.song.id !== trackId) notFound();

  const backHref = `/artist/settings/studios/${encodeURIComponent(producerId)}`;
  return (
    <PastStudioRecordShell
      backHref={backHref}
      studioName={data.studio.name}
      eyebrow="Music record"
      title={data.song.title}
      subtitle={`${data.project.title}${data.song.artist ? ` · ${data.song.artist}` : ""}`}
    >
      <section className="overflow-hidden rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] shadow-[var(--shadow-sm)]">
        <div className="flex items-start justify-between gap-4 p-5">
          <div className="min-w-0">
            <p className="font-mono text-[9px] font-semibold tracking-[0.13em] text-[rgb(var(--fg-muted))] uppercase">
              Preserved version
            </p>
            <h2 className="font-display mt-1 text-xl font-bold tracking-[-0.025em] text-[rgb(var(--fg-default))]">
              {data.version.label}
            </h2>
            <p className="mt-1 text-[12px] text-[rgb(var(--fg-muted))]">
              {dateLabel(data.version.uploadedAt)} ·{" "}
              {durationLabel(data.version.durationMs)}
            </p>
          </div>
          <span className="flex size-10 shrink-0 items-center justify-center rounded-[var(--radius-sm)] bg-[rgb(var(--bg-sunken))] text-[rgb(var(--brand-primary-text))]">
            <FileMusic size={18} aria-hidden />
          </span>
        </div>

        {data.version.audioUrl ? (
          <div className="border-t border-[rgb(var(--border-subtle))] px-5 py-4">
            {/* Native controls keep this archival surface playback-only and
                avoid routing the global player's expand control into active Music. */}
            <audio
              aria-label={`Play ${data.song.title}, ${data.version.label}`}
              className="h-11 w-full"
              controls
              controlsList={data.version.downloadUrl ? undefined : "nodownload"}
              preload="metadata"
              src={data.version.audioUrl}
            >
              Your browser does not support audio playback.
            </audio>
            {data.version.downloadUrl ? (
              <a
                href={data.version.downloadUrl}
                className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] px-4 text-[12.5px] font-bold text-[rgb(var(--fg-default))] hover:bg-[rgb(var(--bg-overlay))]"
              >
                <Download size={15} aria-hidden />
                Download this version
              </a>
            ) : null}
          </div>
        ) : (
          <p className="border-t border-[rgb(var(--border-subtle))] px-5 py-4 text-[12.5px] text-[rgb(var(--fg-muted))]">
            The preserved audio file is unavailable.
          </p>
        )}

        {data.version.description?.trim() ? (
          <p className="border-t border-[rgb(var(--border-subtle))] px-5 py-4 text-[13px] leading-relaxed text-[rgb(var(--fg-secondary))]">
            {data.version.description}
          </p>
        ) : null}
      </section>

      {data.versions.length > 1 ? (
        <section className="mt-5 overflow-hidden rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))]">
          <h2 className="px-5 py-4 text-[13px] font-bold text-[rgb(var(--fg-default))]">
            Preserved versions
          </h2>
          <ul className="list-none divide-y divide-[rgb(var(--border-subtle))] border-t border-[rgb(var(--border-subtle))]">
            {data.versions.map((version) => (
              <li key={version.id}>
                <Link
                  href={`${backHref}/music/${encodeURIComponent(
                    data.song.id,
                  )}/versions/${encodeURIComponent(version.id)}`}
                  aria-current={version.id === data.version.id ? "page" : undefined}
                  className="flex min-h-14 items-center justify-between gap-4 px-5 py-3 text-[13px] hover:bg-[rgb(var(--bg-overlay))]"
                >
                  <span className="font-semibold text-[rgb(var(--fg-default))]">
                    {version.label}
                  </span>
                  <span className="font-mono text-[10px] text-[rgb(var(--fg-muted))]">
                    {dateLabel(version.uploadedAt)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {data.comments.length > 0 ? (
        <section className="mt-5 overflow-hidden rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))]">
          <h2 className="px-5 py-4 text-[13px] font-bold text-[rgb(var(--fg-default))]">
            Preserved comments
          </h2>
          <ul className="list-none divide-y divide-[rgb(var(--border-subtle))] border-t border-[rgb(var(--border-subtle))]">
            {data.comments.map((comment) => (
              <li key={comment.id} className="px-5 py-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-[12px] font-semibold text-[rgb(var(--fg-default))]">
                    {comment.authorName}
                  </p>
                  <p className="font-mono text-[10px] text-[rgb(var(--fg-muted))]">
                    {timestampLabel(comment.timestampMs)}
                  </p>
                </div>
                <p className="mt-1 text-[13px] leading-relaxed text-[rgb(var(--fg-secondary))]">
                  {comment.body}
                </p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </PastStudioRecordShell>
  );
}
