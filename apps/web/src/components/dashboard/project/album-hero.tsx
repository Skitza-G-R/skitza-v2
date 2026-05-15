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
      className="relative overflow-hidden rounded-[var(--radius-lg)] px-6 py-7 text-white"
      style={{ background: heroBg(token) }}
      aria-label={`Album page for ${name}`}
    >
      <div className="flex items-start justify-between gap-6">
        <div className="flex min-w-0 items-start gap-5">
          <span
            className="flex h-28 w-28 shrink-0 items-center justify-center rounded-[var(--radius-md)] text-[28px] font-bold text-white shadow-[var(--shadow-md)]"
            style={{ background: avatarBg }}
            aria-hidden
          >
            {initials}
          </span>

          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-white/60">
              PROJECT · {stageEyebrow}
            </p>
            <h1 className="mt-1.5 truncate font-syne text-[28px] font-bold leading-tight text-white">
              {name}
            </h1>

            <ul className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-white/70">
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

        <div className="flex shrink-0 items-center gap-2">
          {onPlayLatest ? (
            <HeroCTA variant="play" onClick={onPlayLatest}>
              Play latest
            </HeroCTA>
          ) : (
            <HeroCTA variant="play">Play latest</HeroCTA>
          )}
          {onAddSong ? (
            <HeroCTA variant="upload" onClick={onAddSong}>
              Add song
            </HeroCTA>
          ) : (
            <HeroCTA variant="upload">Add song</HeroCTA>
          )}
        </div>
      </div>
    </section>
  );
}
