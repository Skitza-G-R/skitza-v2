"use client";

// Shared chrome for the artist purchase funnel (Commit / Pay / Book).
// Ported from the approved prototype (`skitza-mobile-ui.jsx`), with the
// prototype's hard-coded warm colours swapped for the app's semantic
// tokens (globals.css) so every primitive themes correctly and stays
// consistent with the rest of the artist surface. Funnel screens are a
// FOCUSED flow: back arrow top-left, no bottom tab bar, one primary
// action low and thumb-reachable.

import type { ReactNode } from "react";

import { Check, ChevronLeft } from "./funnel-icons";

// Mono uppercase eyebrow — the recurring "eyebrow → title → body" rhythm.
// `gold` switches from muted to the readable amber used on light surfaces.
export function Eyebrow({
  children,
  gold = false,
  className = "",
}: {
  children: ReactNode;
  gold?: boolean;
  className?: string;
}) {
  return (
    <div
      className={`inline-flex items-center gap-[9px] whitespace-nowrap font-mono text-[10px] font-bold uppercase tracking-[0.16em] ${
        gold
          ? "text-[rgb(var(--brand-primary-dark))]"
          : "text-[rgb(var(--fg-muted))]"
      } ${className}`}
    >
      {children}
    </div>
  );
}

// Solid, blurred top bar for funnel screens with no cover image. Sticks to
// the top of the scroll container; `sk-safe-top` keeps the title clear of
// the device notch.
export function FunnelTopBar({
  title,
  sub,
  onBack,
}: {
  title: string;
  sub?: string;
  onBack?: () => void;
}) {
  return (
    <header
      className="sk-safe-top sticky top-0 z-20"
      style={{
        background: "rgb(var(--bg-background) / 0.9)",
        backdropFilter: "blur(16px) saturate(160%)",
        WebkitBackdropFilter: "blur(16px) saturate(160%)",
        borderBottom: "1px solid rgb(var(--fg-default) / 0.07)",
      }}
    >
      <div className="relative flex h-[52px] items-center justify-center px-[14px]">
        {onBack ? (
          <button
            type="button"
            onClick={onBack}
            aria-label="Back"
            className="sk-press absolute left-[14px] inline-flex h-[38px] w-[38px] items-center justify-center rounded-full"
            style={{
              background: "rgb(var(--bg-elevated))",
              color: "rgb(var(--fg-default))",
              border: "1px solid rgb(var(--fg-default) / 0.08)",
              boxShadow: "var(--shadow-sm)",
            }}
          >
            <ChevronLeft />
          </button>
        ) : null}
        <div className="px-12 text-center">
          <div className="font-syne text-[15px] font-extrabold tracking-tight text-[rgb(var(--fg-default))]">
            {title}
          </div>
          {sub ? (
            <div className="font-mono text-[9px] tracking-[0.08em] text-[rgb(var(--fg-muted))]">
              {sub}
            </div>
          ) : null}
        </div>
      </div>
    </header>
  );
}

// Floating round glass button for chrome over covers / celebration screens.
export function GlassRound({
  children,
  onClick,
  ariaLabel,
}: {
  children: ReactNode;
  onClick?: () => void;
  ariaLabel: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      className="sk-press inline-flex h-[38px] w-[38px] items-center justify-center rounded-full"
      style={{
        background: "rgba(255, 255, 255, 0.86)",
        color: "rgb(var(--fg-default))",
        backdropFilter: "blur(14px) saturate(160%)",
        WebkitBackdropFilter: "blur(14px) saturate(160%)",
        boxShadow: "0 2px 10px rgb(17 16 9 / 0.12)",
        border: "0.5px solid rgb(17 16 9 / 0.06)",
      }}
    >
      {children}
    </button>
  );
}

// Full-width amber primary action, fixed low on funnel screens. `glow` adds
// the amber ring/halo for the key moment; `sub` is the small mono helper
// line (e.g. the disabled reason). Disabled = muted fill + not-allowed.
export function PrimaryCta({
  children,
  onClick,
  disabled = false,
  glow = true,
  sub,
  type = "button",
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  glow?: boolean;
  sub?: ReactNode;
  type?: "button" | "submit";
}) {
  return (
    <button
      type={type}
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      className={`relative flex w-full flex-col items-center gap-[3px] overflow-hidden rounded-[var(--radius-lg)] px-[22px] py-4 text-center font-semibold ${
        disabled ? "cursor-not-allowed" : "sk-press sk-cta-shine"
      }`}
      style={
        disabled
          ? {
              background: "rgb(var(--fg-default) / 0.07)",
              color: "rgb(var(--fg-muted) / 0.8)",
            }
          : {
              background: "rgb(var(--brand-primary))",
              color: "rgb(var(--bg-sidebar))",
              boxShadow: glow ? "var(--shadow-glow)" : "none",
            }
      }
    >
      <span className="relative inline-flex items-center gap-[9px] text-[16px]">
        {children}
      </span>
      {sub ? (
        <span className="relative font-mono text-[10px] font-medium tracking-[0.04em] opacity-70">
          {sub}
        </span>
      ) : null}
    </button>
  );
}

// White secondary action with a strong hairline border.
export function SecondaryCta({
  children,
  onClick,
}: {
  children: ReactNode;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="sk-press flex w-full items-center justify-center gap-[9px] rounded-[var(--radius-lg)] px-[22px] py-[15px] text-[15px] font-semibold"
      style={{
        background: "rgb(var(--bg-elevated))",
        color: "rgb(var(--fg-default))",
        border: "1px solid rgb(var(--border-strong))",
        boxShadow: "var(--shadow-sm)",
      }}
    >
      {children}
    </button>
  );
}

// Inline agreement checkbox row. Renders as a real checkbox for a11y
// (role + aria-checked), styled to match the design. Toggling it is what
// gates the primary "Send request" action on S4.
export function AgreeCheck({
  checked,
  onToggle,
  children,
}: {
  checked: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      onClick={onToggle}
      className="sk-press flex w-full items-center gap-[13px] rounded-[14px] px-4 py-[15px] text-left transition-colors"
      style={{
        background: "rgb(var(--bg-elevated))",
        border: `1.5px solid ${
          checked ? "rgb(var(--brand-primary))" : "rgb(var(--border-strong))"
        }`,
      }}
    >
      <span
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[7px] transition-all"
        style={{
          background: checked ? "rgb(var(--brand-primary))" : "rgb(var(--bg-elevated))",
          border: `2px solid ${
            checked ? "rgb(var(--brand-primary))" : "rgb(var(--border-strong))"
          }`,
          color: "rgb(var(--bg-sidebar))",
        }}
      >
        {checked ? <Check /> : null}
      </span>
      <span className="text-[14px] font-medium leading-snug text-[rgb(var(--fg-default))]">
        {children}
      </span>
    </button>
  );
}
