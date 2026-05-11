"use client";

import { Music2, Plus, SlidersHorizontal, Volume2, type LucideIcon } from "lucide-react";

import type { TileType } from "../kind-to-tile";
import { TILE_THEME } from "../tile-theme";
import type { PresetId } from "../type-presets";
import { TYPE_PRESETS } from "../type-presets";

interface TypeStepProps {
  picked: PresetId | null;
  onPick: (id: PresetId) => void;
}

const ICON_BY_NAME: Record<string, LucideIcon> = {
  "music-2": Music2,
  "sliders-horizontal": SlidersHorizontal,
  "volume-2": Volume2,
  plus: Plus,
};

function presetToTile(id: PresetId): TileType {
  if (id === "blank") return "consult";
  return id;
}

export function TypeStep({ picked, onPick }: TypeStepProps) {
  return (
    <div className="p-6">
      <div className="grid grid-cols-2 gap-3">
        {TYPE_PRESETS.map((p) => {
          const tile = presetToTile(p.id);
          const theme = TILE_THEME[tile];
          const Icon = ICON_BY_NAME[p.icon] ?? Music2;
          const isPicked = picked === p.id;
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => {
                onPick(p.id);
              }}
              className={[
                "sk-press flex items-start gap-3 rounded-[12px] border bg-[rgb(var(--bg-elevated))] p-4 text-left transition-colors",
                p.id === "blank" ? "border-dashed" : "",
                isPicked
                  ? "border-[rgb(var(--brand-primary))] shadow-[0_0_0_3px_rgb(var(--brand-primary)/0.18)]"
                  : "border-[rgb(var(--border-subtle))] hover:border-[rgb(var(--border-strong))]",
              ].join(" ")}
            >
              <span
                aria-hidden
                className="relative shrink-0"
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: 10,
                  background: theme.gradient,
                  boxShadow:
                    "inset 0 1px 0 rgba(255,255,255,0.22), inset 0 -8px 14px rgba(0,0,0,0.16), 0 4px 10px -4px rgba(17,16,9,0.22)",
                }}
              >
                <span className="absolute inset-0 flex items-center justify-center text-white">
                  <Icon size={20} strokeWidth={2.2} />
                </span>
              </span>
              <span className="min-w-0">
                <span className="block font-display text-[15px] font-bold tracking-[-0.02em] text-[rgb(var(--fg-default))]">
                  {p.label}
                </span>
                <span className="mt-0.5 block text-[12.5px] leading-snug text-[rgb(var(--fg-muted))]">
                  {p.desc}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
