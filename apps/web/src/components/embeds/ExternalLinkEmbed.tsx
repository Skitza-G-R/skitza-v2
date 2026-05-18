// Wave 2 S04 Part 2 — single external-link renderer.
// PRD §6.2 Section B. Dispatches to an iframe or a link based on the
// parser's output. Thin component — all logic lives in parsers.ts.

import type { ExternalPlatform } from "@skitza/db";
import { parseEmbed } from "./parsers";

interface Props {
  platform: ExternalPlatform;
  url: string;
  title: string | null;
}

export function ExternalLinkEmbed({ platform, url, title }: Props) {
  const result = parseEmbed(platform, url);

  if (result.type === "link") {
    // Fallback: styled "Listen on <Platform>" button. Opens in a new
    // tab; rel="noopener noreferrer" prevents window.opener leakage.
    return (
      <a
        href={result.href}
        target="_blank"
        rel="noopener noreferrer"
        className="sk-lift inline-flex items-center justify-between gap-3 rounded-[var(--radius-md)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-4 text-sm font-medium text-[rgb(var(--fg-primary))] transition-colors hover:border-[rgb(var(--border-strong))] hover:bg-[rgb(var(--bg-overlay))]"
      >
        <span className="truncate">
          {title ?? `Listen on ${result.platformLabel}`}
        </span>
        <span className="font-mono text-[0.66rem] uppercase tracking-wider text-[rgb(var(--fg-muted))]">
          {result.platformLabel} ↗
        </span>
      </a>
    );
  }

  // iframe path: fixed-height (audio bars) or responsive aspect-ratio
  // (video/reels). Tailwind aspect-* utilities for the ratio variant.
  const aspectClass =
    result.aspectRatio === "16:9"
      ? "aspect-video"
      : result.aspectRatio === "9:16"
        ? "aspect-[9/16]"
        : result.aspectRatio === "1:1"
          ? "aspect-square"
          : "";

  return (
    <div
      className={`overflow-hidden rounded-[var(--radius-md)] ${aspectClass}`}
      style={result.height ? { height: `${result.height.toString()}px` } : undefined}
    >
      <iframe
        src={result.src}
        title={title ?? `${platform} embed`}
        loading="lazy"
        allow="encrypted-media; picture-in-picture; fullscreen; autoplay; clipboard-write"
        className="h-full w-full border-0"
      />
    </div>
  );
}
