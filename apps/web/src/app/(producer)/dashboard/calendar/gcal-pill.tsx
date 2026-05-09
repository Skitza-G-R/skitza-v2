"use client";

// Google Calendar pill — display-only per CLAUDE.md ("GCal sync — UI
// placeholder, Coming soon"). Mirrors the locked design spec § 4.1
// visual language: white surface, subtle border, 4-color Google logo,
// vertical divider, status dot + mono "Synced" text.
//
// When real GCal sync ships (cron + OAuth), this can take a
// `connected | not_connected` prop and the click handler can open
// the OAuth flow. Today: no-op button so producers see the polish
// without us promising a feature that isn't there yet.

export function GCalPill({
  status = "not_connected",
}: {
  status?: "synced" | "not_connected";
}) {
  const isConnected = status === "synced";
  return (
    <button
      type="button"
      title={
        isConnected
          ? "Synced — Google Calendar"
          : "Connect Google Calendar (coming soon)"
      }
      className="sk-press inline-flex items-center gap-2.5 rounded-[9px] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] py-2 pl-2.5 pr-3 text-[0.78rem] tracking-tight text-[rgb(var(--fg-default))] shadow-[0_1px_2px_rgb(17_16_9_/_0.04)] transition-colors hover:border-[rgb(var(--border-strong))]"
      style={{ fontWeight: 600 }}
    >
      <GcalLogo />
      <span className="text-[rgb(var(--fg-default))]">Google Calendar</span>
      <span
        aria-hidden
        className="h-3.5 w-px bg-[rgb(var(--border-subtle))]"
      />
      <span className="inline-flex items-center gap-1.5">
        {isConnected ? (
          <>
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-[sk-soft-pulse_2s_ease-in-out_infinite] rounded-full bg-[rgb(var(--fg-success))] opacity-60" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-[rgb(var(--fg-success))]" />
            </span>
            <span className="font-mono text-[0.72rem] text-[rgb(var(--fg-success))]">
              Synced
            </span>
          </>
        ) : (
          <>
            <span className="h-1.5 w-1.5 rounded-full bg-[rgb(var(--fg-faint))]" />
            <span className="font-mono text-[0.72rem] text-[rgb(var(--fg-muted))]">
              Coming soon
            </span>
          </>
        )}
      </span>
    </button>
  );
}

// The official Google "G" 4-color logo. SVG copied verbatim from the
// reference HTML's <GcalLogo> per the design spec § 4.1.
function GcalLogo() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      aria-hidden
      role="presentation"
    >
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
      />
    </svg>
  );
}
