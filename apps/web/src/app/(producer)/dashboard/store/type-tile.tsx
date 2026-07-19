// type-tile.tsx
//
// 60×60 gradient tile rendered on every product card. Inset shadows +
// radial highlight create depth; the design spec lives in
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
  hidden?: boolean;
}

export function TypeTile({ type, hidden = false }: TypeTileProps) {
  const theme = TILE_THEME[type];
  const Icon = ICON_BY_NAME[theme.iconName] ?? Music2;
  const size = 60;
  const radius = 12;
  const iconSize = 24;

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
