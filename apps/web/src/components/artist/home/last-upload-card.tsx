"use client";

import Link from "next/link";

import {
  playerPlay,
  playerToggle,
  useNowPlaying,
} from "~/components/audio/persistent-player";

import { ProducerArt } from "./producer-art";

// PRIMARY hero card for the SK-33 artist home. 170×170 art + 52px
// amber Play FAB + Syne 26px title — the single brightest, biggest
// tap target on the page. When latestMix is null, renders the same
// chrome with a "Nothing new" empty state.

export type LastUploadProps = {
  latestMix: {
    id: string;
    trackTitle: string;
    label: string | null;
    producerName: string;
    projectId: string;
    uploadedAt: Date;
    audioUrl: string | null;
    durationMs: number | null;
    unread: boolean;
  } | null;
};

const ART_SIZE = 170;
const FAB_SIZE = 52;

export function LastUploadCard({ latestMix }: LastUploadProps) {
  if (!latestMix) return <EmptyState />;
  return <FilledCard latestMix={latestMix} />;
}

function FilledCard({
  latestMix,
}: {
  latestMix: NonNullable<LastUploadProps["latestMix"]>;
}) {
  const { trackId, playing } = useNowPlaying();
  const isThisPlaying = trackId === latestMix.id && playing;
  const onPlay = () => {
    if (isThisPlaying) {
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
    <article className="flex gap-5 rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-5 transition-shadow hover:shadow-sm">
      <div className="relative" style={{ width: ART_SIZE, height: ART_SIZE }}>
        <button
          type="button"
          onClick={onPlay}
          className="absolute inset-0 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary)]"
          aria-label={isThisPlaying ? "Pause track" : "Play track"}
        >
          <ProducerArt
            producerName={latestMix.producerName}
            size={ART_SIZE}
            initialsFontSize={20}
          />
        </button>
        <span
          aria-hidden
          className="pointer-events-none absolute flex items-center justify-center rounded-full"
          style={{
            width: FAB_SIZE,
            height: FAB_SIZE,
            bottom: 10,
            right: 10,
            backgroundColor: "var(--brand-primary)",
            color: "#111009",
            boxShadow: "0 6px 18px rgba(0,0,0,0.28)",
          }}
        >
          {isThisPlaying ? <PauseIcon /> : <PlayIcon />}
        </span>
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center justify-between gap-2">
          <p
            className="uppercase text-[9.5px] font-semibold tracking-[0.12em] text-[var(--fg-muted)]"
            style={{ fontFamily: "var(--font-jetbrains-mono)" }}
          >
            LAST UPLOAD
          </p>
          {latestMix.unread && (
            <span
              className="rounded-full px-1.5 py-0.5 text-[8.5px] font-extrabold uppercase tracking-[0.08em]"
              style={{
                backgroundColor: "var(--brand-primary)",
                color: "#111009",
                fontFamily: "var(--font-jetbrains-mono)",
              }}
            >NEW</span>
          )}
        </div>
        <h2
          className="mt-1 truncate text-[26px] font-extrabold text-[var(--fg-default)]"
          style={{
            fontFamily: "var(--font-syne)",
            letterSpacing: "-0.03em",
            lineHeight: 1.15,
          }}
        >
          {latestMix.trackTitle}
          {latestMix.label ? (
            <span className="text-[var(--fg-muted)]"> · {latestMix.label}</span>
          ) : null}
        </h2>
        <p className="mt-1 truncate text-[12.5px] text-[var(--fg-muted)]">
          {subtitle}
        </p>
        <div className="mt-auto flex items-center gap-2 pt-4">
          <button
            type="button"
            onClick={onPlay}
            className="inline-flex items-center gap-1.5 rounded-full bg-[var(--bg-sidebar)] px-3.5 py-2 text-[13px] font-bold text-[var(--brand-primary)] transition-transform hover:brightness-110 active:scale-[0.97]"
          >
            <PlayIcon size={12} />
            {isThisPlaying ? "Pause track" : "Play track"}
          </button>
          <Link
            href={`/artist/music/${latestMix.projectId}`}
            className="inline-flex items-center gap-1 rounded-full border border-[var(--border-subtle)] px-3.5 py-2 text-[12.5px] font-semibold text-[var(--fg-default)] transition-colors hover:bg-[var(--bg-background)]"
          >
            Open library →
          </Link>
        </div>
      </div>
    </article>
  );
}

function EmptyState() {
  return (
    <article className="flex gap-5 rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-5">
      <div
        className="rounded-[10px] border border-dashed border-[var(--border-subtle)] bg-[var(--bg-background)]"
        style={{ width: ART_SIZE, height: ART_SIZE }}
        aria-hidden
      />
      <div className="flex min-w-0 flex-1 flex-col justify-between">
        <div>
          <p
            className="uppercase text-[9.5px] font-semibold tracking-[0.12em] text-[var(--fg-muted)]"
            style={{ fontFamily: "var(--font-jetbrains-mono)" }}
          >
            LAST UPLOAD
          </p>
          <h2
            className="mt-1 text-[22px] font-extrabold text-[var(--fg-default)]"
            style={{ fontFamily: "var(--font-syne)", letterSpacing: "-0.03em" }}
          >
            Nothing new from your studios yet.
          </h2>
          <p className="mt-1 text-[12.5px] text-[var(--fg-muted)]">
            Mixes show up here the moment a producer uploads.
          </p>
        </div>
        <div className="pt-4">
          <Link
            href="/artist/music"
            className="inline-flex items-center gap-1 rounded-full border border-[var(--border-subtle)] px-3.5 py-2 text-[12.5px] font-semibold text-[var(--fg-default)] transition-colors hover:bg-[var(--bg-background)]"
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
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="currentColor"
      aria-hidden
    >
      <path d="M4 2.5v11l9-5.5z" />
    </svg>
  );
}

function PauseIcon({ size = 18 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="currentColor"
      aria-hidden
    >
      <rect x="3.5" y="2.5" width="3" height="11" rx="0.5" />
      <rect x="9.5" y="2.5" width="3" height="11" rx="0.5" />
    </svg>
  );
}
