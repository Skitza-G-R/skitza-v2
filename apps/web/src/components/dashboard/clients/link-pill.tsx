"use client";

import { ChevronRight } from "lucide-react";

export type LinkPillState = "active" | "pending" | "none";

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
        Linked
      </span>
    );
  }
  if (state === "pending") {
    return (
      <span
        className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border px-2.5 py-0.5 text-[11px] font-medium tracking-wide uppercase"
        style={{
          background: onHero ? "rgb(var(--bg-sidebar) / 0.58)" : "rgb(var(--brand-primary)/0.12)",
          borderColor: onHero ? "rgb(255 255 255 / 0.36)" : "rgb(var(--brand-primary)/0.40)",
          color: onHero ? "rgb(255 255 255)" : "rgb(var(--brand-primary-text))",
        }}
      >
        <span
          className="h-1.5 w-1.5 animate-pulse rounded-full"
          style={{ background: "rgb(var(--brand-primary))" }}
        />
        Invited
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={onInvite}
      className={[
        "inline-flex min-h-[44px] items-center gap-1.5 rounded-[var(--radius-sm)] border px-2.5 py-0.5 text-[11px] font-medium tracking-wide uppercase transition-colors focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none sm:min-h-0",
        onHero
          ? "focus-visible:ring-white focus-visible:ring-offset-transparent"
          : "hover:bg-[rgb(var(--brand-primary)/0.18)] focus-visible:ring-[rgb(var(--brand-primary))] focus-visible:ring-offset-[rgb(var(--bg-background))]",
      ].join(" ")}
      style={{
        background: onHero ? "rgb(var(--bg-sidebar) / 0.58)" : "rgb(var(--brand-primary)/0.10)",
        borderColor: onHero ? "rgb(255 255 255 / 0.36)" : "rgb(var(--brand-primary)/0.40)",
        color: onHero ? "rgb(255 255 255)" : "rgb(var(--brand-primary-text))",
      }}
    >
      <span
        className="h-1.5 w-1.5 rounded-full"
        style={{ background: "rgb(var(--brand-primary))" }}
      />
      Invite to app
      <ChevronRight size={12} />
    </button>
  );
}
