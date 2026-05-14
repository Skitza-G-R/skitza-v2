"use client";

import type { ReactNode } from "react";
import { Play, Upload } from "lucide-react";

// Two pill CTAs used on dark hero bands:
//   - play: solid white background, dark text — primary "Play latest" action
//   - upload: frosted glass with backdrop-blur — secondary "Upload" action

export type HeroCTAVariant = "play" | "upload";

interface HeroCTAProps {
  variant: HeroCTAVariant;
  children?: ReactNode;
  onClick?: () => void;
}

export function HeroCTA({ variant, children, onClick }: HeroCTAProps) {
  if (variant === "play") {
    return (
      <button
        type="button"
        onClick={onClick}
        className="inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 text-[13px] font-semibold text-[#111] shadow-[var(--shadow-md)] transition-transform hover:scale-[1.02] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
      >
        <Play size={14} fill="currentColor" />
        {children ?? "Play latest"}
      </button>
    );
  }
  // upload — frosted glass
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-2 rounded-full border border-white/25 bg-white/10 px-4 py-2 text-[13px] font-medium text-white backdrop-blur-md transition-colors hover:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
    >
      <Upload size={14} />
      {children ?? "Upload"}
    </button>
  );
}
