"use client";

import { MessageSquare, Music } from "lucide-react";

import type { GradientToken } from "~/lib/clients/derive-gradient";
import { heroBg } from "~/lib/clients/hero-bg";
import {
  stageLabel,
  type WorkflowStage,
} from "~/lib/clients/workflow-stage";
import { HeroCTA } from "~/components/dashboard/common/hero-cta";
import { formatDuration } from "~/lib/format/duration";

// SongSpaceHero — the dark gradient band that anchors the new Song
// Space (DESIGN.md §4.4, BUILD-NOTES §5.4). Mirrors the AlbumHero
// shape but adapts for two distinct modes:
//
//   - Album mode  → eyebrow `SONG · MIXING`, meta `from <Album> · v3 · 8 notes · 04:02`
//   - Single mode → eyebrow `SINGLE · MIXING`, meta `<Client> · v3 · 8 notes · 04:02`
//
// Single mode is what the user lands on when the project has exactly
// 1 track (the Single-Space rule — see [id]/page.tsx redirect). The
// gradient + dark hero treatment is identical between modes.
//
// Phase 3: the Play-latest HeroCTA wires its onPlayLatest callback;
// the Upload HeroCTA is ALWAYS disabled (Phase 4 ships the upload
// modal). We render both so the visual rhythm is locked in.

interface SongSpaceHeroSong {
  title: string;
  currentVersion: string;
  noteCount: number;
  durationMs: number | null;
  workflowStage: WorkflowStage;
}

interface SongSpaceHeroProject {
  name: string;
}

interface SongSpaceHeroClient {
  name: string;
}

interface SongSpaceHeroProps {
  mode: "album" | "single";
  song: SongSpaceHeroSong;
  project: SongSpaceHeroProject;
  client: SongSpaceHeroClient;
  gradientToken: GradientToken;
  /** Phase 3 — calls playerPlay with the latest version. Disabled when undefined. */
  onPlayLatest?: () => void;
}

export function SongSpaceHero({
  mode,
  song,
  project,
  client,
  gradientToken,
  onPlayLatest,
}: SongSpaceHeroProps) {
  const stageEyebrow = stageLabel(song.workflowStage).toUpperCase();
  const modeEyebrow = mode === "single" ? "SINGLE" : "SONG";
  const durationStr = formatDuration(song.durationMs);
  const noteSuffix = song.noteCount === 1 ? "note" : "notes";

  return (
    <section
      className="relative overflow-hidden rounded-[var(--radius-lg)] px-6 py-7 text-white"
      style={{ background: heroBg(gradientToken) }}
      aria-label={`Song space for ${song.title}`}
    >
      <div className="flex items-start justify-between gap-6">
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-white/60">
            {modeEyebrow} · {stageEyebrow}
          </p>
          <h1 className="mt-1.5 truncate font-syne text-[28px] font-bold leading-tight text-white">
            {song.title}
          </h1>

          <ul className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-white/70">
            {mode === "single" ? (
              <li className="inline-flex items-center gap-1.5">
                <span className="truncate">{client.name}</span>
              </li>
            ) : (
              <li className="inline-flex items-center gap-1.5">
                <span className="truncate">
                  from <span className="text-white/90">{project.name}</span>
                </span>
              </li>
            )}
            <li className="inline-flex items-center gap-1.5">
              <Music size={12} aria-hidden />
              <span className="font-mono tabular-nums">
                {song.currentVersion}
              </span>
            </li>
            <li className="inline-flex items-center gap-1.5">
              <MessageSquare size={12} aria-hidden />
              <span className="tabular-nums">
                {song.noteCount} {noteSuffix}
              </span>
            </li>
            <li className="inline-flex items-center gap-1.5">
              <span className="font-mono tabular-nums">{durationStr}</span>
            </li>
          </ul>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {onPlayLatest ? (
            <HeroCTA variant="play" onClick={onPlayLatest}>
              Play latest
            </HeroCTA>
          ) : (
            <HeroCTA variant="play" disabled>
              Play latest
            </HeroCTA>
          )}
          {/* Upload is ALWAYS disabled in Phase 3 — Phase 4 wires the
              Upload Track modal. We render the pill so the hero's
              right-side action group has the same visual weight as
              the AlbumHero. */}
          <HeroCTA variant="upload" disabled>
            Upload new version
          </HeroCTA>
        </div>
      </div>
    </section>
  );
}
