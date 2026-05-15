"use client";

import { MessageSquare, Music } from "lucide-react";

import type { GradientToken } from "~/lib/clients/derive-gradient";
import { heroBg } from "~/lib/clients/hero-bg";
import {
  stageLabel,
  type WorkflowStage,
} from "~/lib/clients/workflow-stage";
import { HeroCTA } from "~/components/dashboard/common/hero-cta";
import { HeroGlowOrbs } from "~/components/dashboard/common/hero-glow-orbs";
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
// Phase 4: BOTH HeroCTAs now wire. Play-latest fires playerPlay via
// the parent's `onPlayLatest`. Upload new version fires the parent's
// `onUploadNewVersion`, which opens the shared UploadTrackModal.

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
  /** Phase 4 — opens the UploadTrackModal (mode="new-version"). Disabled when undefined. */
  onUploadNewVersion?: () => void;
}

export function SongSpaceHero({
  mode,
  song,
  project,
  client,
  gradientToken,
  onPlayLatest,
  onUploadNewVersion,
}: SongSpaceHeroProps) {
  const stageEyebrow = stageLabel(song.workflowStage).toUpperCase();
  const modeEyebrow = mode === "single" ? "SINGLE" : "SONG";
  const durationStr = formatDuration(song.durationMs);
  const noteSuffix = song.noteCount === 1 ? "note" : "notes";

  return (
    <section
      // Full-bleed dark band — DESIGN.md hero spec line 252. See
      // album-hero.tsx for the same pattern. No left-side avatar tile
      // here (the song page leads with the title, not a gradient
      // square — design HTML line 1019).
      className="relative -mx-4 overflow-hidden border-b px-[34px] py-9 pb-7 text-white sm:-mx-6"
      style={{
        background: heroBg(gradientToken),
        borderBottomColor: "rgb(var(--border-strong))",
      }}
      aria-label={`Song space for ${song.title}`}
    >
      <HeroGlowOrbs />

      <div className="relative mx-auto flex max-w-[1100px] flex-wrap items-end justify-between gap-6">
        <div className="min-w-0 flex-1">
          <p className="text-[10.5px] font-bold uppercase tracking-[0.18em] text-white/78">
            {modeEyebrow} · {stageEyebrow}
          </p>
          <h1
            className="my-1 truncate font-syne text-[54px] font-extrabold leading-[0.95] tracking-[-0.035em] text-white"
            style={{ textShadow: "0 2px 20px rgba(0,0,0,0.25)" }}
          >
            {song.title}
          </h1>

          <ul className="mt-2 flex flex-wrap items-center gap-x-3.5 gap-y-1 text-[13px] text-white/92">
            {mode === "single" ? (
              <li className="inline-flex items-center gap-1.5">
                <span className="truncate">{client.name}</span>
              </li>
            ) : (
              <li className="inline-flex items-center gap-1.5">
                <span className="truncate">
                  from <span className="text-white">{project.name}</span>
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

        <div className="flex shrink-0 items-center gap-2 self-end">
          {onPlayLatest ? (
            <HeroCTA variant="play" onClick={onPlayLatest}>
              Play latest
            </HeroCTA>
          ) : (
            <HeroCTA variant="play" disabled>
              Play latest
            </HeroCTA>
          )}
          {/* Phase 4 — wires the Upload Track modal. If the parent
              doesn't pass onUploadNewVersion (rare; usually means the
              modal isn't mountable for some reason) we fall back to
              a disabled pill so the hero still composes. */}
          {onUploadNewVersion ? (
            <HeroCTA variant="upload" onClick={onUploadNewVersion}>
              Upload new version
            </HeroCTA>
          ) : (
            <HeroCTA variant="upload" disabled>
              Upload new version
            </HeroCTA>
          )}
        </div>
      </div>
    </section>
  );
}
