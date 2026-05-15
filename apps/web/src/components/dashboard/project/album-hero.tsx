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
      className="relative -mx-4 overflow-hidden border-b px-[34px] py-9 pb-7 text-white sm:-mx-6"
      style={{
        background: heroBg(token),
        borderBottomColor: "rgb(var(--border-strong))",
      }}
      aria-label={`Album page for ${name}`}
    >
      <HeroGlowOrbs />

      <div className="relative mx-auto flex max-w-[1100px] flex-wrap items-end justify-between gap-6">
        <div className="flex min-w-0 items-end gap-[22px]">
          <span
            className="flex h-28 w-28 shrink-0 items-center justify-center rounded-[24px] font-syne text-[42px] font-extrabold text-white shadow-[0_18px_40px_rgba(0,0,0,0.36)]"
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
              className="my-1 truncate font-syne text-[54px] font-extrabold leading-[0.95] tracking-[-0.035em] text-white"
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
