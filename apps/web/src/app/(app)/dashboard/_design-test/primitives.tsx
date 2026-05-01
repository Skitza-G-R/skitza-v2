"use client";

// Skitza Design Test — primitives. 1:1 port of the mockup's primitives.jsx
// (sample-app.html lines 480-697). Every className, every inline style, every
// DOM nesting level matches the mockup exactly. The only translation:
// `window.lucide` → `lucide-react`.
//
// Throwaway sandbox — never merges to main.

import { type CSSProperties, type ReactNode } from "react";
import * as Lucide from "lucide-react";

const IconMap: Record<string, Lucide.LucideIcon> = {
  // Sidebar
  search: Lucide.Search,
  home: Lucide.Home,
  users: Lucide.Users,
  music: Lucide.Music,
  calendar: Lucide.Calendar,
  store: Lucide.Store,
  "trending-up": Lucide.TrendingUp,
  settings: Lucide.Settings,
  "chevron-up": Lucide.ChevronUp,
  // Overview tab
  "link-2": Lucide.Link2,
  copy: Lucide.Copy,
  check: Lucide.Check,
  "alert-circle": Lucide.AlertCircle,
  "chevron-right": Lucide.ChevronRight,
  activity: Lucide.Activity,
  "dollar-sign": Lucide.DollarSign,
  clock: Lucide.Clock,
  // ProjectBadge / misc
  folder: Lucide.Folder,
  play: Lucide.Play,
  pause: Lucide.Pause,
};

type IconProps = {
  name: string;
  size?: number;
  strokeWidth?: number;
  className?: string;
  style?: CSSProperties;
};

export function Icon({
  name,
  size = 16,
  strokeWidth = 2.2,
  className = "",
  style,
}: IconProps) {
  const Cmp = IconMap[name];
  // Preserve the mockup's outer span — same `skicon` className, same display:
  // inline-flex sizing — so layout matches even when the icon name is missing.
  return (
    <span
      className={`skicon ${className}`}
      style={{
        display: "inline-flex",
        width: size,
        height: size,
        ...style,
      }}
    >
      {Cmp ? <Cmp size={size} strokeWidth={strokeWidth} /> : null}
    </span>
  );
}

type PillProps = {
  type?: string;
  children: ReactNode;
  className?: string;
};

export function Pill({ type = "neutral", children, className = "" }: PillProps) {
  return <span className={`pill pill-${type} ${className}`}>{children}</span>;
}

type StatusPillProps = { tagType?: string; label: ReactNode };

export function StatusPill({ tagType = "neutral", label }: StatusPillProps) {
  return <span className={`pill pill-${tagType}`}>{label}</span>;
}

type AvatarProps = {
  initials: ReactNode;
  grad?: string;
  size?: number;
  className?: string;
};

export function Avatar({
  initials,
  grad = "grad-amber",
  size = 32,
  className = "",
}: AvatarProps) {
  return (
    <div
      className={`${grad} ${className}`}
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "Outfit",
        fontWeight: 800,
        fontSize: size * 0.36,
        color: "#111009",
        flexShrink: 0,
        boxShadow:
          "inset 0 0 0 1px rgba(255,255,255,0.2), 0 1px 2px rgba(0,0,0,0.08)",
        letterSpacing: "-0.02em",
      }}
    >
      {initials}
    </div>
  );
}

type CardProps = {
  title?: ReactNode;
  icon?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  dense?: boolean;
  padded?: boolean;
};

export function Card({
  title,
  icon,
  action,
  children,
  className = "",
  dense = false,
  padded = true,
}: CardProps) {
  return (
    <section
      className={`surface-card ${className}`}
      style={{ display: "flex", flexDirection: "column", minHeight: 0 }}
    >
      {(title || action) && (
        <header
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: dense ? "12px 16px" : "14px 18px",
            borderBottom: "1px solid rgb(var(--border-subtle) / 0.7)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {icon && (
              <span
                style={{
                  color: "rgb(var(--fg-muted))",
                  display: "inline-flex",
                }}
              >
                {icon}
              </span>
            )}
            <h3
              className="font-syne"
              style={{
                margin: 0,
                fontSize: 14,
                fontWeight: 700,
                letterSpacing: "-0.01em",
              }}
            >
              {title}
            </h3>
          </div>
          {action}
        </header>
      )}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          padding: padded ? (dense ? "8px" : "10px") : 0,
          display: "flex",
          flexDirection: "column",
        }}
      >
        {children}
      </div>
    </section>
  );
}

type PlayCircleProps = {
  playing?: boolean;
  size?: number;
  dark?: boolean;
  onClick?: (e: React.MouseEvent | React.KeyboardEvent) => void;
};

export function PlayCircle({
  playing,
  size = 36,
  dark = false,
  onClick,
}: PlayCircleProps) {
  return (
    <span
      role="button"
      tabIndex={0}
      onClick={(e) => {
        e.stopPropagation();
        onClick?.(e);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          e.stopPropagation();
          onClick?.(e);
        }
      }}
      className="sk-pop"
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        border: dark ? "none" : "1px solid rgb(var(--border-subtle))",
        background: dark ? "white" : "rgb(var(--bg-elevated))",
        color: dark ? "#111009" : "rgb(var(--fg-default))",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: "pointer",
        flexShrink: 0,
        boxShadow: dark
          ? "0 4px 14px rgba(0,0,0,0.28)"
          : "0 1px 3px rgba(17,16,9,0.06)",
      }}
      aria-label={playing ? "Pause" : "Play"}
    >
      <Icon
        name={playing ? "pause" : "play"}
        size={size * 0.42}
        strokeWidth={2.4}
      />
    </span>
  );
}

export function fmtMoney(n: number): string {
  return "$" + n.toLocaleString();
}

type ProjectBadgeProps = {
  grad?: string;
  size?: number;
  rounded?: number;
  icon?: string;
};

export function ProjectBadge({
  grad = "grad-amber",
  size = 36,
  rounded = 12,
  icon = "folder",
}: ProjectBadgeProps) {
  return (
    <div
      className={grad}
      style={{
        width: size,
        height: size,
        borderRadius: rounded,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
        boxShadow:
          "inset 0 0 0 1px rgba(255,255,255,0.18), 0 1px 2px rgba(0,0,0,0.08)",
      }}
    >
      <Icon
        name={icon}
        size={size * 0.45}
        className=""
        style={{ color: "rgba(255,255,255,0.85)" }}
      />
    </div>
  );
}

// FAKE_WAVE/Waveform/EqBars are only consumed by the audio player + song
// page in the mockup. Overview doesn't use them — re-add when porting
// Music Library.
