// tile-theme.ts
//
// Per-tile visual theme. Source-of-truth for the gradient, icon, and
// hover-accent stripe color used on a product card. The handoff
// (storefront.html, TYPE_META constant) defines these gradients
// verbatim. Accent picked as the gradient's lighter stop so the
// 3px hover stripe is visible against the warm bg.

import type { TileType } from "./kind-to-tile";

interface TileTheme {
  gradient: string;
  iconName: string;
  accent: string;
}

export const TILE_THEME: Record<TileType, TileTheme> = {
  mix: {
    gradient: "linear-gradient(135deg, #d97706, #b45309)",
    iconName: "sliders-horizontal",
    accent: "#d97706",
  },
  master: {
    gradient: "linear-gradient(135deg, #c2410c, #9a3412)",
    iconName: "volume-2",
    accent: "#c2410c",
  },
  production: {
    gradient: "linear-gradient(135deg, #059669, #065f46)",
    iconName: "music-2",
    accent: "#059669",
  },
  consult: {
    gradient: "linear-gradient(135deg, #475569, #1e293b)",
    iconName: "message-square",
    accent: "#475569",
  },
};
