// type-tile.tsx
//
// Gradient tile rendered on every product card. Two sizes: 60×60
// (cards view), 32×32 (table view, Phase 3). Inset shadows + radial
// highlight create depth; the design spec lives in
// docs/plans/active/2026-05-10-storefront-redesign-design.md §4.

"use client";

import {
  EyeOff,
  Music2,
  MessageSquare,
  SlidersHorizontal,
  Volume2,
  type LucideIcon,
} from "lucide-react";

import type { TileType } from "./kind-to-tile";
import { TILE_THEME } from "./tile-theme";

const ICON_BY_NAME: Record<string, LucideIcon> = {
  "sliders-horizontal": SlidersHorizontal,
  "volume-2": Volume2,
  "music-2": Music2,
  "message-square": MessageSquare,
};

interface TypeTileProps {
  type: TileType;
  size?: 32 | 60;
  hidden?: boolean;
}

export function TypeTile({ type, size = 60, hidden = false }: TypeTileProps) {
  const theme = TILE_THEME[type];
  const Icon = ICON_BY_NAME[theme.iconName] ?? Music2;
  // Tile sizing is exactly two presets — when size === 60 (cards
  // view) we use the larger 12/24 pair; otherwise (size === 32,
  // table view) we use 8/16.
  const radius = size === 60 ? 12 : 8;
  const iconSize = size === 60 ? 24 : 16;

  return (
    <div
      aria-hidden
      className="relative shrink-0"
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        background: theme.gradient,
        boxShadow:
          "inset 0 1px 0 rgba(255,255,255,0.22), inset 0 -10px 16px rgba(0,0,0,0.16), 0 4px 10px -4px rgba(17,16,9,0.22)",
      }}
    >
      {/* Radial highlight overlay top-left */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          borderRadius: radius,
          background:
            "radial-gradient(120% 120% at 0% 0%, rgba(255,255,255,0.32), transparent 55%)",
        }}
      />
      <span className="absolute inset-0 flex items-center justify-center text-white">
        <Icon size={iconSize} strokeWidth={2.2} />
      </span>
      {hidden ? (
        <span
          aria-hidden
          className="absolute inset-0 flex items-center justify-center"
          style={{ borderRadius: radius, background: "rgba(17,16,9,0.55)" }}
        >
          <EyeOff size={iconSize} strokeWidth={2.2} className="text-white/85" />
        </span>
      ) : null}
    </div>
  );
}
