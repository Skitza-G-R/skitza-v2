"use client";

import Link from "next/link";

import { playerPlay, playerToggle, useNowPlaying } from "~/components/audio/persistent-player";
import { withArtistStudio } from "~/lib/artist-studio-context";

import { ProducerArt } from "./producer-art";

// PRIMARY hero card for the SK-33 artist home. 140×140 art (96×96
// below sm so the title keeps room at 390px) + amber Play FAB + Syne
// title — the single brightest, biggest tap target on the page. When
// latestMix is null, renders the same chrome with a "Nothing new"
// empty state.

export type LastUploadProps = {
  latestMix: {
    id: string;
    trackTitle: string;
    label: string | null;
    producerName: string;
    producerId: string;
    projectId: string;
    uploadedAt: Date;
    audioUrl: string | null;
    durationMs: number | null;
    unread: boolean;
  } | null;
};

const ART_SIZE = 140;
const ART_SIZE_SM = 96;

export function LastUploadCard({
  latestMix,
  activeStudioId,
}: LastUploadProps & { activeStudioId?: string | null | undefined }) {
  if (!latestMix) return <EmptyState activeStudioId={activeStudioId} />;
  return <FilledCard latestMix={latestMix} />;
}

function FilledCard({ latestMix }: { latestMix: NonNullable<LastUploadProps["latestMix"]> }) {
  const { trackId, playing } = useNowPlaying();
  const isThisTrack = trackId === latestMix.id;
  const isThisPlaying = isThisTrack && playing;
  const onPlay = () => {
    if (isThisTrack) {
      playerToggle();
      return;
    }
    playerPlay({
      id: latestMix.id,
      audioUrl: latestMix.audioUrl,
      title: `${latestMix.trackTitle}${latestMix.label ? ` · ${latestMix.label}` : ""}`,
      subtitle: latestMix.producerName,
      durationMs: latestMix.durationMs,
    });
  };
  const subtitle = `${latestMix.producerName} · ${relativeFrom(latestMix.uploadedAt)}`;
  return (
    <article className="grid grid-cols-[auto_minmax(0,1fr)] grid-rows-[auto_auto_1fr_auto] gap-x-4 rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-4 transition-shadow hover:shadow-sm sm:grid-rows-[auto_auto_auto_1fr]">
      <div className="relative row-span-3 self-start sm:row-span-4">
        <button
          type="button"
          onClick={onPlay}
          className="block cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))]"
          aria-label={isThisPlaying ? "Pause track" : "Play track"}
        >
          <div className="sm:hidden">
            <ProducerArt
              producerName={latestMix.producerName}
              size={ART_SIZE_SM}
              initialsFontSize={15}
            />
          </div>
          <div className="hidden sm:block">
            <ProducerArt
              producerName={latestMix.producerName}
              size={ART_SIZE}
              initialsFontSize={20}
            />
          </div>
        </button>
        <span
          aria-hidden
          className="pointer-events-none absolute right-1.5 bottom-1.5 flex size-9 items-center justify-center rounded-full sm:right-2.5 sm:bottom-2.5 sm:size-11"
          style={{
            backgroundColor: "rgb(var(--brand-primary))",
            color: "#111009",
            boxShadow: "0 6px 18px rgba(0,0,0,0.28)",
            outline: "3px solid rgb(var(--bg-elevated))",
            outlineOffset: "-1px",
          }}
        >
          {isThisPlaying ? <PauseIcon /> : <PlayIcon />}
        </span>
      </div>
      <div className="flex items-center justify-between gap-2 self-start">
        <p
          className="text-[9.5px] font-semibold tracking-[0.12em] text-[rgb(var(--fg-muted))] uppercase"
          style={{ fontFamily: "var(--font-jetbrains-mono)" }}
        >
          LAST UPLOAD
        </p>
        {latestMix.unread && (
          <span
            className="rounded-full px-1.5 py-0.5 text-[8.5px] font-extrabold tracking-[0.08em] uppercase"
            style={{
              backgroundColor: "rgb(var(--brand-primary))",
              color: "#111009",
              fontFamily: "var(--font-jetbrains-mono)",
            }}
          >
            NEW
          </span>
        )}
      </div>
      <h2
        className="col-start-2 mt-1 text-[20px] font-extrabold text-[rgb(var(--fg-default))] max-sm:line-clamp-2 sm:truncate sm:text-[24px]"
        style={{
          fontFamily: "var(--font-syne)",
          letterSpacing: "-0.03em",
          lineHeight: 1.15,
        }}
      >
        {latestMix.trackTitle}
        {latestMix.label ? (
          <span className="text-[rgb(var(--fg-muted))]"> · {latestMix.label}</span>
        ) : null}
      </h2>
      <p className="col-start-2 mt-1 self-start truncate text-[12.5px] text-[rgb(var(--fg-muted))]">
        {subtitle}
      </p>
      <div className="col-span-2 flex flex-wrap items-center gap-2 pt-4 sm:col-span-1 sm:col-start-2 sm:self-end">
        <button
          type="button"
          onClick={onPlay}
          className="sk-press inline-flex min-h-11 items-center gap-1.5 rounded-[var(--radius-lg)] bg-[rgb(var(--bg-sidebar))] px-3.5 py-2 text-[13px] font-bold whitespace-nowrap text-[rgb(var(--brand-primary))] transition-transform hover:brightness-110 active:scale-[0.97]"
        >
          <PlayIcon size={12} />
          {isThisPlaying ? "Pause track" : "Play track"}
        </button>
        <Link
          href={withArtistStudio(`/artist/music/${latestMix.projectId}`, latestMix.producerId)}
          className="sk-press inline-flex min-h-11 items-center gap-1 rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] px-3.5 py-2 text-[12.5px] font-semibold whitespace-nowrap text-[rgb(var(--fg-default))] transition-colors hover:bg-[rgb(var(--bg-background))]"
        >
          Open library →
        </Link>
      </div>
    </article>
  );
}

function EmptyState({ activeStudioId }: { activeStudioId?: string | null | undefined }) {
  return (
    <article className="flex gap-4 rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-4">
      <div
        className="flex size-[96px] shrink-0 items-center justify-center rounded-[10px] bg-[rgb(var(--bg-sunken))] text-[rgb(var(--fg-faint))] sm:size-[140px]"
        aria-hidden
      >
        <MusicNoteIcon />
      </div>
      <div className="flex min-w-0 flex-1 flex-col justify-between">
        <div>
          <p
            className="text-[9.5px] font-semibold tracking-[0.12em] text-[rgb(var(--fg-muted))] uppercase"
            style={{ fontFamily: "var(--font-jetbrains-mono)" }}
          >
            LAST UPLOAD
          </p>
          <h2
            className="mt-1 text-[18px] font-extrabold text-[rgb(var(--fg-default))] sm:text-[22px]"
            style={{ fontFamily: "var(--font-syne)", letterSpacing: "-0.03em" }}
          >
            Nothing new from your studios yet.
          </h2>
          <p className="mt-1 text-[12.5px] text-[rgb(var(--fg-muted))]">
            Mixes show up here the moment a producer uploads.
          </p>
        </div>
        <div className="pt-4">
          <Link
            href={withArtistStudio("/artist/music", activeStudioId)}
            className="sk-press inline-flex min-h-11 items-center gap-1 rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] px-3.5 py-2 text-[12.5px] font-semibold text-[rgb(var(--fg-default))] transition-colors hover:bg-[rgb(var(--bg-background))]"
          >
            Open library →
          </Link>
        </div>
      </div>
    </article>
  );
}

function relativeFrom(date: Date): string {
  const diffMs = Date.now() - date.getTime();
  const min = Math.floor(diffMs / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${String(min)} min ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${String(hr)}h ago`;
  const days = Math.floor(hr / 24);
  if (days === 1) return "Yesterday";
  if (days < 7) return `${String(days)} days ago`;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function PlayIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor" aria-hidden>
      <path d="M4 2.5v11l9-5.5z" />
    </svg>
  );
}

function PauseIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor" aria-hidden>
      <rect x="3.5" y="2.5" width="3" height="11" rx="0.5" />
      <rect x="9.5" y="2.5" width="3" height="11" rx="0.5" />
    </svg>
  );
}

function MusicNoteIcon() {
  return (
    <svg width={28} height={28} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" />
    </svg>
  );
}
