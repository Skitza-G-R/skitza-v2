"use client";

import Link from "next/link";
import { ChevronRight, Pause, Play } from "lucide-react";
import type { MouseEvent } from "react";

import { playerPlay, playerToggle, useNowPlaying } from "~/components/audio/persistent-player";
import { producerGradient } from "~/lib/_phase4-stubs/producer-color";
import { projectSongWorkspaceHref } from "~/lib/clients/project-song-workspace-href";
import { stageColor, stageLabel, type WorkflowStage } from "~/lib/clients/workflow-stage";

export interface TrackRowPlayback {
  versionId: string;
  audioUrl: string;
  versionLabel: string;
  projectName: string;
  durationMs?: number;
}

export interface TrackRowData {
  id: string;
  title: string;
  artist: string | null;
  workflowStage: WorkflowStage;
  progress: number;
  currentVersion?: string;
  noteCount?: number;
  durationMs?: number;
  versionCount?: number;
  playback?: TrackRowPlayback;
}

export interface TrackRowProps {
  projectId: string;
  track: TrackRowData;
  index: number;
  selected?: boolean;
}

function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "0:00";
  const totalSec = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSec / 60);
  const seconds = totalSec % 60;
  return `${String(minutes)}:${String(seconds).padStart(2, "0")}`;
}

export function TrackRow({ projectId, track, index, selected = false }: TrackRowProps) {
  const nowPlaying = useNowPlaying();
  const indexLabel = String(index).padStart(2, "0");
  const coverBg = producerGradient(track.title);
  const stageHue = stageColor(track.workflowStage);
  const clampedProgress = Math.max(0, Math.min(100, Math.round(track.progress)));
  const playback = track.playback;
  const isPlaying = playback
    ? nowPlaying.trackId === playback.versionId && nowPlaying.playing
    : false;

  const metaParts: string[] = [];
  if (track.artist) metaParts.push(track.artist);
  if (track.currentVersion) metaParts.push(track.currentVersion);
  if (typeof track.noteCount === "number" && track.noteCount > 0) {
    metaParts.push(`${String(track.noteCount)} note${track.noteCount === 1 ? "" : "s"}`);
  }
  if (typeof track.durationMs === "number" && track.durationMs > 0) {
    metaParts.push(formatDuration(track.durationMs));
  }
  const meta = metaParts.join(" · ");

  function handlePlay(event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.stopPropagation();
    if (!playback) return;
    if (nowPlaying.trackId === playback.versionId) {
      playerToggle();
      return;
    }
    playerPlay({
      id: playback.versionId,
      audioUrl: playback.audioUrl,
      title: track.title,
      subtitle: `${playback.projectName} · ${playback.versionLabel}`,
      durationMs: playback.durationMs ?? null,
      cachePolicy: "account-unlocked",
    });
  }

  return (
    <article
      className={`group flex min-w-0 items-center overflow-hidden rounded-[var(--radius-lg)] border transition-colors ${
        selected
          ? "border-[rgb(var(--brand-primary)/0.55)] bg-[rgb(var(--brand-primary)/0.06)] shadow-[var(--shadow-sm)]"
          : "border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-background))] hover:bg-[rgb(var(--bg-elevated))]"
      }`}
    >
      <Link
        href={projectSongWorkspaceHref(projectId, track.id)}
        replace
        scroll={false}
        aria-label={`View ${track.title} in this project`}
        aria-current={selected ? "true" : undefined}
        className="flex min-h-[68px] min-w-0 flex-1 items-center gap-3 px-3 py-2.5 focus-visible:ring-2 focus-visible:ring-[rgb(var(--focus-ring))] focus-visible:outline-none focus-visible:ring-inset sm:px-4"
      >
        <span className="hidden w-6 shrink-0 font-mono text-[11px] text-[rgb(var(--fg-muted))] tabular-nums sm:block">
          {indexLabel}
        </span>

        <span
          aria-hidden
          className="h-11 w-11 shrink-0 rounded-[var(--radius-md)]"
          style={{ background: coverBg }}
        />

        <span className="min-w-0 flex-1">
          <span className="block truncate text-[14.5px] leading-tight font-bold text-[rgb(var(--fg-default))] transition-colors group-hover:text-[rgb(var(--brand-primary-dark))]">
            {track.title}
          </span>
          <span className="mt-1 flex min-w-0 items-center gap-1.5 text-[11.5px] text-[rgb(var(--fg-muted))]">
            <span
              aria-hidden
              className="h-1.5 w-1.5 shrink-0 rounded-full"
              style={{ background: stageHue }}
            />
            <span className="truncate">
              {stageLabel(track.workflowStage)}
              {meta ? ` · ${meta}` : ""}
            </span>
          </span>
          <span
            role="progressbar"
            aria-label={`${track.title} progress`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={clampedProgress}
            aria-valuetext={`${String(clampedProgress)}% complete`}
            className="mt-2 block h-[2px] max-w-[220px] overflow-hidden rounded-full bg-[rgb(var(--border-subtle))]"
          >
            <span
              className="block h-full rounded-full bg-[rgb(var(--brand-primary))]"
              style={{ width: `${String(clampedProgress)}%` }}
            />
          </span>
        </span>

        <ChevronRight
          size={16}
          strokeWidth={2.1}
          className="hidden shrink-0 text-[rgb(var(--fg-muted))] sm:block"
          aria-hidden
        />
      </Link>

      <button
        type="button"
        onClick={handlePlay}
        disabled={!playback}
        aria-label={
          playback
            ? `${isPlaying ? "Pause" : "Play"} ${track.title}`
            : `No playable audio for ${track.title}`
        }
        className="sk-press mr-3 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[rgb(var(--fg-default))] text-[rgb(var(--bg-background))] shadow-[var(--shadow-sm)] focus-visible:ring-2 focus-visible:ring-[rgb(var(--focus-ring))] focus-visible:outline-none disabled:cursor-not-allowed disabled:bg-[rgb(var(--fg-default)/0.08)] disabled:text-[rgb(var(--fg-muted))] disabled:shadow-none sm:mr-4"
      >
        {isPlaying ? (
          <Pause size={14} fill="currentColor" aria-hidden />
        ) : (
          <Play size={14} fill="currentColor" aria-hidden />
        )}
      </button>
    </article>
  );
}
