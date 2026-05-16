"use client";

import type { ReactNode } from "react";
import { Play, Upload } from "lucide-react";

// Two pill CTAs used on dark hero bands:
//   - play: solid white background, dark text — primary "Play latest" action
//   - upload: frosted glass with backdrop-blur — secondary "Upload" action
//
// `disabled` mutes the button (opacity-50, not-allowed cursor, no hover
// scale) and adds a `title="Coming soon"` tooltip. The native `disabled`
// attribute makes the button non-focusable and non-clickable for keyboard
// + mouse users. Use this for CTAs that are visible in the UI but whose
// behavior ships in a later phase.

export type HeroCTAVariant = "play" | "upload";

interface HeroCTAProps {
  variant: HeroCTAVariant;
  children?: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
}

export function HeroCTA({ variant, children, onClick, disabled }: HeroCTAProps) {
  const title = disabled ? "Coming soon" : undefined;
  if (variant === "play") {
    return (
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        title={title}
        className="inline-flex items-center gap-2 rounded-[var(--radius-md)] bg-white px-4 py-2 text-[13px] font-semibold text-[#111] shadow-[var(--shadow-md)] transition-transform hover:scale-[1.02] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100"
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
      disabled={disabled}
      title={title}
      className="inline-flex items-center gap-2 rounded-[var(--radius-md)] border border-white/25 bg-white/10 px-4 py-2 text-[13px] font-medium text-white backdrop-blur-md transition-colors hover:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-white/10"
    >
      <Upload size={14} />
      {children ?? "Upload"}
    </button>
  );
}
