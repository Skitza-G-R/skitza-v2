import Link from "next/link";

// Download — DARK world. Pre-launch state: every platform (macOS +
// Windows + Linux + companion mobile apps) is flagged "coming soon".
// The previous live macOS CTA pointed at a GitHub Releases URL that
// 404s until a signed DMG is tagged — real signed binaries require
// Apple Developer cert + Tauri CI, which is its own infra project.
// Until that lands, the whole section presents a uniform honest
// "coming soon" state so nothing on this page sends visitors to a
// broken download.
//
// Mobile: cards stack to min-h-12 single column. No new backend —
// the waitlist signal is the same "Start free" conversion at the top
// of the page; we'll email desktop-app availability when it ships.
export function Download() {
  return (
    <section
      data-theme="chrome-dark"
      id="download"
      className="relative bg-[rgb(var(--bg-base))] py-24 text-[rgb(var(--fg-primary))] sm:py-32"
    >
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <span
          className="absolute right-[-10%] top-[10%] h-[30rem] w-[30rem] rounded-full blur-[120px]"
          style={{ background: "rgba(212,150,10,0.08)" }}
        />
      </div>

      <div className="relative mx-auto max-w-4xl px-6">
        <p className="text-center font-mono text-[0.72rem] uppercase tracking-[0.18em] text-[rgb(var(--brand-primary))]">
          Desktop app · coming soon
        </p>
        <h2
          className="mt-3 text-center font-display text-[clamp(2rem,5vw,3.5rem)] leading-[1.05] tracking-tight"
          style={{ fontWeight: 800 }}
        >
          Your whole studio,
          <span className="block italic text-[rgb(var(--brand-primary))]">
            in your dock.
          </span>
        </h2>
        <p className="mx-auto mt-5 max-w-xl text-center text-[rgb(var(--fg-secondary))]">
          The Skitza desktop app gives you Finder drag-and-drop, native
          notifications, and a global{" "}
          <kbd className="rounded border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] px-1.5 py-0.5 font-mono text-[0.72rem] text-[rgb(var(--fg-primary))]">
            ⌥ ⌘ Space
          </kbd>{" "}
          shortcut — open any session in a tap. The web app is live today;
          signed desktop binaries ship this quarter.
        </p>

        <div className="mt-10 grid gap-3 sm:grid-cols-2">
          {PLATFORMS.map((p) => (
            <div
              key={p.label}
              aria-disabled
              className="flex min-h-12 items-center justify-between gap-4 rounded-[var(--radius-lg)] border border-[rgb(var(--border-subtle))] bg-[rgb(var(--bg-elevated))] p-5 opacity-70"
            >
              <div className="flex items-center gap-3">
                <span
                  aria-hidden
                  className="flex h-10 w-10 items-center justify-center rounded-[var(--radius-md)] bg-[rgb(var(--bg-sunken))] text-[rgb(var(--fg-muted))]"
                >
                  {p.icon}
                </span>
                <div className="text-left">
                  <p className="font-display text-lg tracking-tight" style={{ fontWeight: 700 }}>
                    {p.label}
                  </p>
                  <p className="font-mono text-[0.7rem] uppercase tracking-wider text-[rgb(var(--fg-muted))]">
                    {p.note}
                  </p>
                </div>
              </div>
              <span className="font-mono text-[0.7rem] uppercase tracking-wider text-[rgb(var(--fg-muted))]">
                Coming soon
              </span>
            </div>
          ))}
        </div>

        <p className="mt-6 text-center font-mono text-[11px] text-[rgb(var(--fg-muted))]">
          Desktop builds land when the signed Tauri pipeline + Apple
          Developer cert are in place. In the meantime, the web app
          covers every flow — bookings, contracts, audio, payments.
        </p>
        <p className="mt-2 text-center font-mono text-[11px] text-[rgb(var(--fg-muted))]">
          Want a ping when the Mac build ships?{" "}
          <Link
            href="/sign-up"
            className="text-[rgb(var(--brand-primary))] underline-offset-4 hover:underline"
          >
            Start free
          </Link>{" "}
          — we&rsquo;ll email you the moment it&rsquo;s available.
        </p>
      </div>
    </section>
  );
}

// Ordered macOS → Windows → Linux → mobile companions. macOS leads
// because it's the most-requested platform among solo producers
// (Logic / Ableton dominance), then Windows (FL / Cubase), then
// Linux (Bitwig / Ardour), then the iOS / Android companion apps
// that plug into the same account.
const PLATFORMS: readonly { label: string; icon: React.ReactNode; note: string }[] = [
  {
    label: "macOS",
    note: "Apple silicon · 13+",
    icon: (
      <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden>
        <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.81-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z" />
      </svg>
    ),
  },
  {
    label: "Windows",
    note: "10 / 11 · x64",
    icon: (
      <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden>
        <path d="M3 5.48L10.56 4.4v7.35H3V5.48zm0 13.04l7.56 1.08v-7.23H3v6.15zm8.4 1.2L21 21v-8.4h-9.6v7.12zm0-15.48V11.4H21V3l-9.6 1.24z" />
      </svg>
    ),
  },
  {
    label: "Linux",
    note: "AppImage · deb",
    icon: (
      <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden>
        <path d="M12 2c-1.66 0-3 1.34-3 3 0 .73.26 1.4.69 1.92-.75.63-1.25 1.58-1.25 2.66v3.92L6 16v4h12v-4l-2.44-2.5V9.58c0-1.08-.5-2.03-1.25-2.66.43-.52.69-1.19.69-1.92 0-1.66-1.34-3-3-3zM10.5 9c.28 0 .5.22.5.5s-.22.5-.5.5-.5-.22-.5-.5.22-.5.5-.5zm3 0c.28 0 .5.22.5.5s-.22.5-.5.5-.5-.22-.5-.5.22-.5.5-.5z" />
      </svg>
    ),
  },
  {
    label: "iOS",
    note: "Companion app",
    icon: (
      <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden>
        <path d="M7 2h10a3 3 0 013 3v14a3 3 0 01-3 3H7a3 3 0 01-3-3V5a3 3 0 013-3zm5 17.5a1 1 0 100-2 1 1 0 000 2z" />
      </svg>
    ),
  },
  {
    label: "Android",
    note: "Companion app",
    icon: (
      <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden>
        <path d="M17.6 9.48l1.84-3.18a.4.4 0 00-.7-.38l-1.86 3.22C15.5 8.44 13.8 8 12 8s-3.5.44-4.88 1.14L5.26 5.92a.4.4 0 00-.7.38l1.84 3.18A7.94 7.94 0 003 16h18a7.94 7.94 0 00-3.4-6.52zM7.5 14a1 1 0 110-2 1 1 0 010 2zm9 0a1 1 0 110-2 1 1 0 010 2z" />
      </svg>
    ),
  },
];
