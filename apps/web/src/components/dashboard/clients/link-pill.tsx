"use client";

import { ChevronRight } from "lucide-react";

import type { LinkPillState } from "./client-invitation-state";

export type { LinkPillState } from "./client-invitation-state";

interface LinkPillProps {
  state: LinkPillState;
  onInvite?: () => void;
  appearance?: "surface" | "hero";
}

export function LinkPill({ state, onInvite, appearance = "surface" }: LinkPillProps) {
  const onHero = appearance === "hero";
  if (state === "active") {
    return (
      <span
        className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border px-2.5 py-0.5 text-[11px] font-medium tracking-wide uppercase"
        style={{
          background: onHero ? "rgb(var(--bg-sidebar) / 0.58)" : "rgb(var(--fg-success)/0.12)",
          borderColor: onHero ? "rgb(255 255 255 / 0.36)" : "rgb(var(--fg-success)/0.40)",
          color: onHero ? "rgb(255 255 255)" : "rgb(var(--fg-success-text))",
        }}
      >
        <span
          className="h-1.5 w-1.5 rounded-full"
          style={{ background: "rgb(var(--fg-success))" }}
        />
        Connected
      </span>
    );
  }
  const invited = state === "pending";
  const failed = state === "failed";
  const sending = state === "sending";
  const label = invited
    ? "Invited"
    : failed
      ? onInvite
        ? "Retry"
        : "Failed"
      : sending
        ? onInvite
          ? "Check status"
          : "Sending"
        : "Invite";
  const background = onHero
    ? "rgb(var(--bg-sidebar) / 0.58)"
    : failed
      ? "rgb(var(--fg-danger)/0.09)"
      : invited
        ? "rgb(var(--brand-primary)/0.12)"
        : "rgb(var(--brand-primary)/0.10)";
  const borderColor = onHero
    ? "rgb(255 255 255 / 0.36)"
    : failed
      ? "rgb(var(--fg-danger)/0.35)"
      : "rgb(var(--brand-primary)/0.40)";
  const color = onHero
    ? "rgb(255 255 255)"
    : failed
      ? "rgb(var(--fg-danger-text))"
      : "rgb(var(--brand-primary-text))";

  if (!onInvite) {
    return (
      <span
        className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border px-2.5 py-0.5 text-[11px] font-medium tracking-wide uppercase"
        style={{ background, borderColor, color }}
      >
        <span
          className={`h-1.5 w-1.5 rounded-full ${sending || invited ? "animate-pulse motion-reduce:animate-none" : ""}`}
          style={{ background: failed ? "rgb(var(--fg-danger))" : "rgb(var(--brand-primary))" }}
        />
        {label}
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={onInvite}
      className={[
        "inline-flex min-h-[44px] items-center gap-1.5 rounded-[var(--radius-lg)] border px-2.5 py-0.5 text-[11px] font-medium tracking-wide uppercase transition-colors focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none sm:min-h-0",
        onHero
          ? "focus-visible:ring-white focus-visible:ring-offset-transparent"
          : failed
            ? "hover:bg-[rgb(var(--fg-danger)/0.14)] focus-visible:ring-[rgb(var(--fg-danger))] focus-visible:ring-offset-[rgb(var(--bg-background))]"
            : "hover:bg-[rgb(var(--brand-primary)/0.18)] focus-visible:ring-[rgb(var(--brand-primary))] focus-visible:ring-offset-[rgb(var(--bg-background))]",
      ].join(" ")}
      style={{ background, borderColor, color }}
    >
      <span
        className={`h-1.5 w-1.5 rounded-full ${sending || invited ? "animate-pulse motion-reduce:animate-none" : ""}`}
        style={{ background: failed ? "rgb(var(--fg-danger))" : "rgb(var(--brand-primary))" }}
      />
      {label}
      <ChevronRight size={12} />
    </button>
  );
}
