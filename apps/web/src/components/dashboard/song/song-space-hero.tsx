"use client";

import { MessageSquare, Music } from "lucide-react";

import type { GradientToken } from "~/lib/clients/derive-gradient";
import { heroBg } from "~/lib/clients/hero-bg";
import { stageLabel, type WorkflowStage } from "~/lib/clients/workflow-stage";
import { producerGradient } from "~/lib/_phase4-stubs/producer-color";
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
  uploadDisabledReason?: string;
}

export function SongSpaceHero({
  mode,
  song,
  project,
  client,
  gradientToken,
  onPlayLatest,
  onUploadNewVersion,
  uploadDisabledReason,
}: SongSpaceHeroProps) {
  const stageEyebrow = stageLabel(song.workflowStage).toUpperCase();
  const modeEyebrow = mode === "single" ? "SINGLE" : "SONG";
  const durationStr = formatDuration(song.durationMs);
  const noteSuffix = song.noteCount === 1 ? "note" : "notes";
  // Avatar tile gradient — seeded by the song title so each track gets
  // a stable, distinct color identity. Matches the AlbumHero pattern.
  // QA against the design prototype (image of "Sunrise" song page)
  // showed the avatar tile was missing in v1 — the older "no avatar
  // on the song page" comment was wrong.
  const avatarBg = producerGradient(song.title);

  return (
    <section
      // Full-bleed dark band — DESIGN.md hero spec line 252. See
      // album-hero.tsx for the same pattern. Includes the music-
      // icon avatar on the left to match the design prototype.
      // <md: tighter band padding + stacked layout (the desktop row
      // rendered the song title invisible at 390px). md+: original.
      className="relative -mx-4 overflow-hidden border-b px-5 py-5 text-white sm:-mx-6 md:px-8 md:py-7"
      style={{
        background: heroBg(gradientToken),
        borderBottomColor: "rgb(var(--border-strong))",
      }}
      aria-label={`Song space for ${song.title}`}
    >
      <HeroGlowOrbs />

      <div className="relative mx-auto flex max-w-[1100px] flex-wrap items-center justify-between gap-4 md:gap-5">
        <div className="flex min-w-0 flex-1 items-center gap-3.5 md:gap-5">
          <span
            className="flex h-[68px] w-[68px] shrink-0 items-center justify-center rounded-[18px] text-white md:h-24 md:w-24 md:rounded-[22px]"
            style={{
              background: avatarBg,
              boxShadow: "0 18px 40px rgba(0,0,0,0.36), inset 0 0 0 1px rgba(255,255,255,0.16)",
            }}
            aria-hidden
          >
            <Music className="md:hidden" size={30} strokeWidth={2.4} />
            <Music className="hidden md:block" size={44} strokeWidth={2.4} />
          </span>

          <div className="min-w-0 flex-1">
            <p className="text-[10.5px] font-bold tracking-[0.18em] text-white/78 uppercase">
              {modeEyebrow} · {stageEyebrow}
            </p>
            <h1
              // <md the title wraps up to 2 lines instead of truncating.
              // md+ keeps the one-line 54px crop.
              className="font-syne my-1 line-clamp-2 text-[26px] leading-[1.06] font-extrabold tracking-[-0.035em] text-white md:line-clamp-none md:truncate md:text-[44px] md:leading-[0.98]"
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
                <span className="font-mono tabular-nums">{song.currentVersion}</span>
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
        </div>

        <div className="flex w-full items-center gap-2 md:w-auto md:shrink-0 md:self-end [&>button]:min-h-[44px] [&>button]:flex-1 [&>button]:justify-center md:[&>button]:min-h-0 md:[&>button]:flex-none">
          {onPlayLatest ? (
            <HeroCTA variant="play" onClick={onPlayLatest}>
              Play latest
            </HeroCTA>
          ) : (
            <HeroCTA variant="play" disabled disabledReason="No playable audio yet.">
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
            <HeroCTA
              variant="upload"
              disabled
              disabledReason={uploadDisabledReason ?? "New work is unavailable."}
            >
              Upload new version
            </HeroCTA>
          )}
        </div>
      </div>
    </section>
  );
}
