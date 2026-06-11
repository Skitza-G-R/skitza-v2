"use client";

import { Music, Mic, DollarSign } from "lucide-react";

import {
  producerGradient,
  producerInitials,
} from "~/lib/_phase4-stubs/producer-color";
import { deriveGradient } from "~/lib/clients/derive-gradient";
import { heroBg } from "~/lib/clients/hero-bg";
import {
  stageLabel,
  type WorkflowStage,
} from "~/lib/clients/workflow-stage";
import { HeroCTA } from "~/components/dashboard/common/hero-cta";
import { HeroGlowOrbs } from "~/components/dashboard/common/hero-glow-orbs";

// AlbumHero — the dark gradient band that anchors the new Album Page
// (DESIGN.md §4.3, BUILD-NOTES §5.3). Mirrors ClientSpaceHero's shape:
// 112px avatar tile + eyebrow + h1 + meta line on the left, two
// HeroCTA pills on the right (Play latest / Add song).

export interface AlbumHeroProject {
  id: string;
  name: string;
  clientName: string;
  songsCount: number;
  sessionsCount: number;
  totalCents: number;
  currency: string;
  workflowStage: WorkflowStage;
}

interface AlbumHeroProps {
  project: AlbumHeroProject;
  onPlayLatest?: () => void;
  onAddSong?: () => void;
}

function formatMoney(cents: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(0)} ${currency}`;
  }
}

export function AlbumHero({
  project,
  onPlayLatest,
  onAddSong,
}: AlbumHeroProps) {
  const {
    name,
    clientName,
    songsCount,
    sessionsCount,
    totalCents,
    currency,
    workflowStage,
  } = project;

  const initials = producerInitials(name);
  const avatarBg = producerGradient(name);
  const token = deriveGradient(name);
  const stageEyebrow = stageLabel(workflowStage).toUpperCase();

  return (
    <section
      // Full-bleed dark band — DESIGN.md hero spec line 252: no
      // border-radius, full edge-to-edge background. Negative
      // horizontal margins cancel the page padding (`px-4 sm:px-6` on
      // the parent <main>) so the hero stretches to the content-area
      // edges while body content below keeps its gutters. Bottom
      // border (--border-strong) creates the design's hairline beneath.
      // <md: tighter band padding + stacked layout (the desktop row
      // crushed "Debut Album" to "De…" at 390px). md+: original values.
      className="relative -mx-4 overflow-hidden border-b px-5 py-6 pb-6 text-white sm:-mx-6 md:px-[34px] md:py-9 md:pb-7"
      style={{
        background: heroBg(token),
        borderBottomColor: "rgb(var(--border-strong))",
      }}
      aria-label={`Album page for ${name}`}
    >
      <HeroGlowOrbs />

      <div className="relative mx-auto flex max-w-[1100px] flex-wrap items-end justify-between gap-4 md:gap-6">
        <div className="flex min-w-0 items-center gap-3.5 md:items-end md:gap-[22px]">
          <span
            className="flex h-[72px] w-[72px] shrink-0 items-center justify-center rounded-[18px] font-syne text-[26px] font-extrabold text-white shadow-[0_18px_40px_rgba(0,0,0,0.36)] md:h-28 md:w-28 md:rounded-[24px] md:text-[42px]"
            style={{
              background: avatarBg,
              boxShadow:
                "0 18px 40px rgba(0,0,0,0.36), inset 0 0 0 1px rgba(255,255,255,0.16)",
            }}
            aria-hidden
          >
            {initials}
          </span>

          <div className="min-w-0 flex-1">
            <p className="text-[10.5px] font-bold uppercase tracking-[0.18em] text-white/78">
              PROJECT · {stageEyebrow}
            </p>
            <h1
              // <md the title wraps up to 2 lines instead of
              // truncating — Syne at 26px measured against SK-54's
              // 390px budget. md+ keeps the one-line 54px crop.
              className="my-1 line-clamp-2 font-syne text-[26px] font-extrabold leading-[1.06] tracking-[-0.035em] text-white md:line-clamp-none md:truncate md:text-[54px] md:leading-[0.95]"
              style={{ textShadow: "0 2px 20px rgba(0,0,0,0.25)" }}
            >
              {name}
            </h1>

            <ul className="mt-2 flex flex-wrap items-center gap-x-3.5 gap-y-1 text-[13px] text-white/92">
              <li className="inline-flex items-center gap-1.5">
                <span className="truncate">{clientName}</span>
              </li>
              <li className="inline-flex items-center gap-1.5">
                <Music size={12} aria-hidden />
                <span>
                  {songsCount} {songsCount === 1 ? "song" : "songs"}
                </span>
              </li>
              <li className="inline-flex items-center gap-1.5">
                <Mic size={12} aria-hidden />
                <span>
                  {sessionsCount}{" "}
                  {sessionsCount === 1 ? "session" : "sessions"}
                </span>
              </li>
              <li className="inline-flex items-center gap-1.5">
                <DollarSign size={12} aria-hidden />
                <span>{formatMoney(totalCents, currency)}</span>
              </li>
            </ul>
          </div>
        </div>

        <div className="flex w-full items-center gap-2 [&>button]:min-h-[44px] [&>button]:flex-1 [&>button]:justify-center md:w-auto md:shrink-0 md:self-end md:[&>button]:min-h-0 md:[&>button]:flex-none">
          {onPlayLatest ? (
            <HeroCTA variant="play" onClick={onPlayLatest}>
              Play latest
            </HeroCTA>
          ) : (
            <HeroCTA variant="play" disabled>
              Play latest
            </HeroCTA>
          )}
          {onAddSong ? (
            <HeroCTA variant="upload" onClick={onAddSong}>
              Add song
            </HeroCTA>
          ) : (
            <HeroCTA variant="upload" disabled>
              Add song
            </HeroCTA>
          )}
        </div>
      </div>
    </section>
  );
}
