/* eslint-disable @typescript-eslint/no-unnecessary-condition, @typescript-eslint/no-confusing-void-expression */
"use client";

// Skitza Design Test — primitives. 1:1 port of the mockup's primitives.jsx
// (sample-app/index.html lines 480-697). Every className, every inline
// style, every DOM nesting level matches the mockup exactly. The only
// translation: `window.lucide` → `lucide-react`.

import {
  type CSSProperties,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";
import * as Lucide from "lucide-react";

// Name → lucide-react component map. Mirrors the mockup's `<Icon name="…" />`
// API so the rest of the file (and any future ported tab) can stay
// verbatim. Adding new icons is one line. Built from a full grep of
// every icon name used across the mockup (overview, clients-projects,
// music, calendar, storefront, insights, settings, project room, song
// page, command palette, mobile chrome).
const IconMap: Record<string, Lucide.LucideIcon> = {
  activity: Lucide.Activity,
  "alert-circle": Lucide.AlertCircle,
  archive: Lucide.Archive,
  "arrow-left": Lucide.ArrowLeft,
  "arrow-up-right": Lucide.ArrowUpRight,
  "at-sign": Lucide.AtSign,
  "audio-waveform": Lucide.AudioWaveform,
  bell: Lucide.Bell,
  calendar: Lucide.Calendar,
  check: Lucide.Check,
  "check-circle": Lucide.CheckCircle,
  "chevron-down": Lucide.ChevronDown,
  "chevron-left": Lucide.ChevronLeft,
  "chevron-right": Lucide.ChevronRight,
  "chevron-up": Lucide.ChevronUp,
  clock: Lucide.Clock,
  code: Lucide.Code,
  copy: Lucide.Copy,
  "corner-down-left": Lucide.CornerDownLeft,
  "credit-card": Lucide.CreditCard,
  "disc-3": Lucide.Disc3,
  "dollar-sign": Lucide.DollarSign,
  download: Lucide.Download,
  "external-link": Lucide.ExternalLink,
  eye: Lucide.Eye,
  "eye-off": Lucide.EyeOff,
  feather: Lucide.Feather,
  "file-audio": Lucide.FileAudio,
  "file-text": Lucide.FileText,
  flag: Lucide.Flag,
  "flask-conical": Lucide.FlaskConical,
  folder: Lucide.Folder,
  "folder-kanban": Lucide.FolderKanban,
  globe: Lucide.Globe,
  guitar: Lucide.Guitar,
  "help-circle": Lucide.HelpCircle,
  home: Lucide.Home,
  image: Lucide.Image,
  info: Lucide.Info,
  // Instagram-specific glyph isn't exported in lucide-react v1.8 —
  // Globe is the closest neutral substitute for the storefront's
  // social-link list.
  instagram: Lucide.Globe,
  "layout-grid": Lucide.LayoutGrid,
  link: Lucide.Link,
  "link-2": Lucide.Link2,
  "list-plus": Lucide.ListPlus,
  mail: Lucide.Mail,
  "message-circle": Lucide.MessageCircle,
  "message-square": Lucide.MessageSquare,
  mic: Lucide.Mic,
  "more-horizontal": Lucide.MoreHorizontal,
  music: Lucide.Music,
  package: Lucide.Package,
  pause: Lucide.Pause,
  pencil: Lucide.Pencil,
  pin: Lucide.Pin,
  play: Lucide.Play,
  plug: Lucide.Plug,
  plus: Lucide.Plus,
  "qr-code": Lucide.QrCode,
  quote: Lucide.Quote,
  repeat: Lucide.Repeat,
  search: Lucide.Search,
  send: Lucide.Send,
  settings: Lucide.Settings,
  "shopping-bag": Lucide.ShoppingBag,
  "skip-back": Lucide.SkipBack,
  "skip-forward": Lucide.SkipForward,
  "sliders-horizontal": Lucide.SlidersHorizontal,
  sparkles: Lucide.Sparkles,
  star: Lucide.Star,
  store: Lucide.Store,
  "trash-2": Lucide.Trash2,
  "trending-up": Lucide.TrendingUp,
  upload: Lucide.Upload,
  user: Lucide.User,
  "user-plus": Lucide.UserPlus,
  users: Lucide.Users,
  wallet: Lucide.Wallet,
  x: Lucide.X,
  zap: Lucide.Zap,
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

// Pill is here for completeness even though OverviewTab uses inline pill
// classes directly. Future tabs reach for it via window.SK.Pill in the
// mockup — keep the API identical.
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

// ─── KebabMenu ──────────────────────────────────────────────────────
// 3-dots dropdown used on project rows + client cards. Click-outside
// closes. Items can carry an `icon` (string), `label`, `onClick`, an
// optional `shortcut` (rendered right-aligned in JetBrains Mono), and
// `danger: true` to render in the danger color.
export type KebabItem = {
  label: string;
  icon: string;
  onClick?: () => void;
  shortcut?: string;
  danger?: boolean;
};

export function KebabMenu({ items }: { items: KebabItem[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  return (
    <span
      ref={ref}
      style={{ position: "relative", display: "inline-flex" }}
      onClick={(e) => {
        e.stopPropagation();
        e.preventDefault();
      }}
    >
      <span
        role="button"
        tabIndex={0}
        onClick={() => setOpen((o) => !o)}
        className="sk-pop"
        style={{
          width: 28,
          height: 28,
          borderRadius: 6,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          cursor: "pointer",
          color: "rgb(var(--fg-muted))",
        }}
        aria-label="More actions"
      >
        <Icon name="more-horizontal" size={15} />
      </span>
      {open && (
        <div
          role="menu"
          style={{
            position: "absolute",
            top: 32,
            right: 0,
            zIndex: 50,
            minWidth: 200,
            padding: 4,
            borderRadius: 10,
            background: "rgb(var(--bg-elevated))",
            border: "1px solid rgb(var(--border-strong))",
            boxShadow: "0 12px 30px rgba(17,16,9,0.18)",
          }}
        >
          {items.map((it, i) => (
            <button
              key={i}
              onClick={(e) => {
                e.stopPropagation();
                setOpen(false);
                it.onClick?.();
              }}
              className="sk-row"
              style={{
                all: "unset",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: 9,
                padding: "8px 10px",
                borderRadius: 7,
                fontSize: 12.5,
                fontWeight: 500,
                color: it.danger
                  ? "rgb(var(--fg-danger))"
                  : "rgb(var(--fg-default))",
                width: "100%",
                boxSizing: "border-box",
              }}
            >
              <Icon
                name={it.icon}
                size={13}
                style={{
                  color: it.danger
                    ? "rgb(var(--fg-danger))"
                    : "rgb(var(--fg-muted))",
                }}
              />
              {it.label}
              {it.shortcut && (
                <span
                  style={{
                    marginLeft: "auto",
                    fontSize: 10,
                    fontFamily: "JetBrains Mono",
                    color: "rgb(var(--fg-faint))",
                  }}
                >
                  {it.shortcut}
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </span>
  );
}

// ─── PinStar ────────────────────────────────────────────────────────
// Pin/unpin star in front of project rows. The mockup uses
// `--brand-primary-dark` here but that variable isn't defined; we map
// it to `--brand-primary` so the visual result still reads as "amber
// when pinned". Cosmetic shortcut, not a logic divergence.
export function PinStar({
  on,
  onToggle,
  label = "Pin",
}: {
  on: boolean;
  onToggle?: () => void;
  label?: string;
}) {
  return (
    <span
      role="button"
      tabIndex={0}
      onClick={(e) => {
        e.stopPropagation();
        e.preventDefault();
        onToggle?.();
      }}
      className="sk-pop"
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: "pointer",
        color: on ? "rgb(var(--brand-primary))" : "rgb(var(--fg-faint))",
        width: 24,
        height: 24,
      }}
      title={on ? "Pinned" : label}
    >
      <Icon name="pin" size={13} strokeWidth={2.2} />
    </span>
  );
}

// ─── FavStar ────────────────────────────────────────────────────────
// Star in the music library's track rows.
export function FavStar({
  on,
  onToggle,
  size = 14,
}: {
  on: boolean;
  onToggle?: () => void;
  size?: number;
}) {
  return (
    <span
      role="button"
      tabIndex={0}
      onClick={(e) => {
        e.stopPropagation();
        onToggle?.();
      }}
      className="sk-pop"
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: "pointer",
        color: on ? "rgb(var(--brand-primary))" : "rgb(var(--fg-faint))",
        width: 24,
        height: 24,
      }}
      aria-label={on ? "Unfavorite" : "Favorite"}
      title={on ? "In Favorites" : "Add to Favorites"}
    >
      <Icon name="star" size={size} strokeWidth={2.4} />
    </span>
  );
}

// ─── EqBars ─────────────────────────────────────────────────────────
// Mini animated equalizer for the now-playing indicator.
export function EqBars({
  playing,
  color = "currentColor",
  count = 3,
}: {
  playing: boolean;
  color?: string;
  count?: number;
}) {
  return (
    <span
      className={playing ? "" : "eq-paused"}
      style={{
        display: "inline-flex",
        alignItems: "flex-end",
        gap: 2,
        height: 14,
      }}
    >
      {Array.from({ length: count }).map((_, i) => (
        <span
          key={i}
          className="eq-bar"
          style={{
            width: 2,
            background: color,
            borderRadius: 1,
            height: "60%",
            animationDelay: `${String(i * 0.18)}s`,
          }}
        />
      ))}
    </span>
  );
}

// ─── NowPlayingDot ──────────────────────────────────────────────────
// EqBars wrapper used in track rows. Returns null when not playing so
// the row's right column collapses cleanly.
export function NowPlayingDot({ playing }: { playing: boolean }) {
  if (!playing) return null;
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        color: "rgb(var(--brand-primary))",
        fontSize: 9.5,
        fontFamily: "JetBrains Mono",
        fontWeight: 700,
      }}
    >
      <EqBars playing />
    </span>
  );
}

// ─── StatTile ───────────────────────────────────────────────────────
// Small KPI tile used in Project Room Overview sub-tab.
export function StatTile({
  label,
  value,
  mono = false,
  accent = false,
  trend,
}: {
  label: string;
  value: ReactNode;
  mono?: boolean;
  accent?: boolean;
  trend?: ReactNode;
}) {
  return (
    <div
      className="surface-card"
      style={{
        padding: "12px 14px",
        display: "flex",
        flexDirection: "column",
        gap: 4,
        minHeight: 72,
      }}
    >
      <span className="label-tiny">{label}</span>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <span
          className={mono ? "tabular" : ""}
          style={{
            fontSize: 22,
            fontWeight: 800,
            letterSpacing: "-0.02em",
            color: accent
              ? "rgb(var(--brand-primary))"
              : "rgb(var(--fg-default))",
            fontFamily: mono ? "JetBrains Mono" : undefined,
          }}
        >
          {value}
        </span>
        {trend}
      </div>
    </div>
  );
}
