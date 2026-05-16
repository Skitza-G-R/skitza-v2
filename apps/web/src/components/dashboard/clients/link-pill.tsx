"use client";

import { ChevronRight } from "lucide-react";

export type LinkPillState = "active" | "pending" | "none";

interface LinkPillProps {
  state: LinkPillState;
  onInvite?: () => void;
}

export function LinkPill({ state, onInvite }: LinkPillProps) {
  if (state === "active") {
    return (
      <span
        className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border px-2.5 py-0.5 text-[11px] font-medium uppercase tracking-wide"
        style={{
          background: "rgb(var(--fg-success)/0.12)",
          borderColor: "rgb(var(--fg-success)/0.40)",
          color: "rgb(var(--fg-success))",
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
        className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border px-2.5 py-0.5 text-[11px] font-medium uppercase tracking-wide"
        style={{
          background: "rgb(var(--brand-primary)/0.12)",
          borderColor: "rgb(var(--brand-primary)/0.40)",
          color: "rgb(var(--brand-primary))",
        }}
      >
        <span
          className="h-1.5 w-1.5 rounded-full animate-pulse"
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
      className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border px-2.5 py-0.5 text-[11px] font-medium uppercase tracking-wide transition-colors hover:bg-[rgb(var(--brand-primary)/0.18)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary))] focus-visible:ring-offset-2 focus-visible:ring-offset-[rgb(var(--bg-background))]"
      style={{
        background: "rgb(var(--brand-primary)/0.10)",
        borderColor: "rgb(var(--brand-primary)/0.40)",
        color: "rgb(var(--brand-primary))",
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
