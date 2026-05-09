"use client";

// Shared modal frame for the Sessions tab action modals (Change time,
// Send reminder, Cancel session). Wraps the Radix-backed <Dialog>
// primitive with the spec § 5.3 "ModalShell" treatment:
//
//   - 64px hero gradient strip tinted by `tone`
//   - 52px white icon plate overlapping the strip by 26px
//   - eyebrow (mono uppercase, tinted) + Syne 800 title
//   - subtitle (12.5px muted)
//   - body slot
//   - footer slot (top-divided, right-aligned)
//
// Two tones are wired today: brand (default amber) and danger (red,
// for the Cancel session modal). Adding tones is a matter of
// extending TONE_TOKENS.

import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogClose,
} from "~/components/ui/dialog";

import type { ReactNode } from "react";

type Tone = "brand" | "danger";

const TONE_TOKENS: Record<Tone, { token: string; eyebrowToken: string }> = {
  brand: {
    token: "--brand-primary",
    eyebrowToken: "--brand-primary-dark",
  },
  danger: {
    token: "--fg-danger",
    eyebrowToken: "--fg-danger",
  },
};

export function SessionModalShell({
  open,
  onOpenChange,
  tone = "brand",
  eyebrow,
  title,
  subtitle,
  icon,
  body,
  footer,
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  tone?: Tone;
  eyebrow: string;
  title: string;
  subtitle?: string;
  icon: ReactNode;
  body: ReactNode;
  footer: ReactNode;
}) {
  const tokens = TONE_TOKENS[tone];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="!grid-cols-1 !gap-0 !p-0 sm:!max-w-[480px]">
        {/* Hero strip — gradient band tinted by tone. */}
        <div
          className="relative h-[64px] w-full overflow-hidden rounded-t-[var(--radius-xl)] sm:rounded-t-[var(--radius-lg)]"
          style={{
            background: `linear-gradient(135deg, rgb(var(${tokens.token}) / 0.95) 0%, rgb(var(${tokens.token}) / 0.65) 100%)`,
          }}
        >
          <DialogClose
            className="absolute right-3 top-3 inline-flex h-8 w-8 items-center justify-center rounded-full border border-white/30 bg-white/15 text-white backdrop-blur transition-colors hover:bg-white/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
            title="Close (Esc)"
            aria-label="Close"
          >
            <CloseIcon />
          </DialogClose>
        </div>

        {/* Icon plate — overlaps the hero strip by 26px. */}
        <div className="relative -mt-[26px] px-7">
          <div
            className="inline-flex h-[52px] w-[52px] items-center justify-center rounded-[14px] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] text-[rgb(var(${tokens.token}))] shadow-[0_4px_12px_rgb(17_16_9_/_0.08)]"
          >
            <div
              className="inline-flex h-[38px] w-[38px] items-center justify-center rounded-[10px]"
              style={{
                background: `linear-gradient(135deg, rgb(var(${tokens.token}) / 0.18), rgb(var(${tokens.token}) / 0.06))`,
                color: `rgb(var(${tokens.token}))`,
              }}
            >
              {icon}
            </div>
          </div>
        </div>

        {/* Title + subtitle. */}
        <div className="px-7 pb-1 pt-3">
          <p
            className="font-mono text-[9.5px] uppercase tracking-[0.14em]"
            style={{
              fontWeight: 700,
              color: `rgb(var(${tokens.eyebrowToken}))`,
            }}
          >
            {eyebrow}
          </p>
          <DialogTitle
            className="mt-1 font-display text-[22px] leading-tight"
            style={{ fontWeight: 800, letterSpacing: "-0.025em" }}
          >
            {title}
          </DialogTitle>
          {subtitle ? (
            <DialogDescription className="mt-1.5 text-[12.5px] text-[rgb(var(--fg-muted))]">
              {subtitle}
            </DialogDescription>
          ) : (
            // Radix requires a description for a11y — use sr-only when
            // no visible subtitle.
            <DialogDescription className="sr-only">
              {title}
            </DialogDescription>
          )}
        </div>

        {/* Body slot. */}
        <div className="px-7 pb-6 pt-4">
          <div className="flex flex-col gap-4">{body}</div>
        </div>

        {/* Footer — top-divided, right-aligned. */}
        <div className="flex items-center justify-end gap-2 rounded-b-[var(--radius-xl)] border-t border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated)/0.4)] px-6 py-4 sm:rounded-b-[var(--radius-lg)]">
          {footer}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function CloseIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

export function ModalGhostButton({
  children,
  onClick,
  disabled,
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="sk-press inline-flex h-9 items-center justify-center rounded-[10px] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-4 text-[12.5px] text-[rgb(var(--fg-secondary))] transition-colors hover:text-[rgb(var(--fg-default))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))] disabled:opacity-50"
      style={{ fontWeight: 600 }}
    >
      {children}
    </button>
  );
}

export function ModalPrimaryButton({
  children,
  onClick,
  disabled,
  tone = "brand",
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  tone?: "brand" | "danger" | "dark";
}) {
  const bg =
    tone === "danger"
      ? "rgb(var(--fg-danger))"
      : tone === "dark"
        ? "rgb(var(--fg-default))"
        : "rgb(var(--brand-primary))";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="sk-press inline-flex h-9 items-center justify-center rounded-[10px] px-4 text-[12.5px] text-white transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))] disabled:cursor-not-allowed disabled:opacity-50"
      style={{ background: bg, fontWeight: 700 }}
    >
      {children}
    </button>
  );
}
