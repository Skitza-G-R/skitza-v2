import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";

// Phase 3 (v3 — docs/qa/phase-3-handoff.md). Split-screen brand panel
// + Clerk form. Mobile-first: single column with the panel collapsed
// to a small header strip; desktop ≥lg flips to a 1.05fr / 1fr grid
// with the full brand panel on the left and Clerk's `<SignIn>` /
// `<SignUp>` mounted on the right.
//
// Per the cross-cutting decision in
// `docs/qa/phase-3-4-5-briefs.md`:
// - Path A: keep Clerk's default `<SignIn>` / `<SignUp>` (no Clerk
//   Elements). The form internals are already styled via the
//   ClerkProvider `appearance` prop in the root layout (Phase 1
//   wired the locked palette; Phase 3 enhances `elements` for the
//   split-screen tonal context).
// - The waitlist + sign-up gating UI from the v3 design source is
//   retired (PRD §3.5 — every auth surface drives Clerk directly).
//
// The `(public)/layout.tsx` parent sets `data-theme="chrome-dark"`
// on a wrapper. This auth layout opts back into the warm cream
// palette by inline-overriding the same tokens — same pattern as
// `(public)/(legal)/layout.tsx` — because the BrandPanel is
// already dark on its own; the right column hosting Clerk's form
// should stay light to match the rest of the workspace.
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div
      style={LIGHT_TOKENS}
      className="relative min-h-dvh overflow-hidden bg-[rgb(var(--bg-base))] text-[rgb(var(--fg-primary))]"
    >
      <div className="grid min-h-dvh grid-cols-1 lg:grid-cols-[1.05fr_1fr]">
        <BrandPanel />
        <FormColumn>{children}</FormColumn>
      </div>
    </div>
  );
}

// Inline-token override — see comment above. Token NAMES stay
// identical so every nested `rgb(var(--bg-elevated))` etc.
// keeps working unchanged.
const LIGHT_TOKENS: CSSProperties & Record<string, string> = {
  "--bg-base": "242 237 230",
  "--bg-elevated": "255 255 255",
  "--bg-overlay": "246 240 231",
  "--bg-sunken": "232 226 217",
  "--fg-primary": "17 16 9",
  "--fg-secondary": "61 55 48",
  "--fg-muted": "107 99 89",
  "--fg-inverse": "242 237 230",
  "--border-subtle": "232 225 212",
  "--border-strong": "200 192 178",
  colorScheme: "light",
};

// =============================================================================
// BrandPanel — left column on desktop, condensed top strip on mobile
// =============================================================================

function BrandPanel() {
  return (
    <aside
      // Mobile: short header band; desktop: full-height column.
      className="relative overflow-hidden px-6 py-7 text-white sm:px-10 lg:px-14 lg:py-12"
      style={{
        background:
          "linear-gradient(155deg, #100E07 0%, #1d1810 55%, #2c2412 100%)",
      }}
    >
      {/* Ambient glow blobs — pointer-events-none so the form
          column behind on mobile remains clickable. */}
      <span
        aria-hidden
        className="pointer-events-none absolute -right-20 -top-32 h-[360px] w-[360px] rounded-full"
        style={{
          background:
            "radial-gradient(circle, rgba(212,150,10,0.32) 0%, rgba(212,150,10,0) 70%)",
        }}
      />
      <span
        aria-hidden
        className="pointer-events-none absolute -bottom-44 -left-32 h-[480px] w-[480px] rounded-full"
        style={{
          background:
            "radial-gradient(circle, rgba(176,104,48,0.22) 0%, rgba(176,104,48,0) 70%)",
        }}
      />

      <div className="relative z-10 flex h-full flex-col justify-between gap-10 lg:gap-12">
        {/* Logo */}
        <Link
          href="/"
          className="group inline-flex items-center gap-2.5 self-start"
          aria-label="Skitza home"
        >
          <span
            className="font-syne flex h-8 w-8 items-center justify-center rounded-[9px] text-[18px] font-extrabold"
            style={{
              background: "rgb(var(--brand-primary))",
              color: "#100E07",
              letterSpacing: "-0.04em",
            }}
            aria-hidden
          >
            S
          </span>
          <span
            className="font-syne text-[19px] font-extrabold tracking-tight"
            style={{ letterSpacing: "-0.04em" }}
          >
            skitza
          </span>
        </Link>

        {/* Hero copy — desktop only, mobile gets the lighter inline
            header inside FormColumn instead. */}
        <div className="hidden max-w-[480px] lg:block">
          <div
            className="mb-4 text-[11px] font-bold uppercase tracking-[0.22em]"
            style={{ color: "rgba(255,255,255,0.55)" }}
          >
            The hall
          </div>
          <h1
            className="font-syne mb-4 text-[42px] font-extrabold leading-[1.05] sm:text-[48px]"
            style={{ letterSpacing: "-0.035em" }}
          >
            Where producers run<br />the business of music.
          </h1>
          <p
            className="mb-8 max-w-[420px] text-[15px] leading-[1.55]"
            style={{ color: "rgba(255,255,255,0.72)" }}
          >
            Bookings, projects, files, payouts — one place, your tone, your terms.
            No more glue between five tools.
          </p>

          {/* Social proof strip */}
          <div className="flex items-center gap-3.5">
            <div className="flex">
              {(["#D4960A", "#B06830", "#A17106", "#7c5a14"] as const).map(
                (c, i) => (
                  <div
                    key={c}
                    className="h-[30px] w-[30px] rounded-full"
                    style={{
                      background: c,
                      border: "2px solid #1d1810",
                      marginLeft: i ? -8 : 0,
                    }}
                    aria-hidden
                  />
                ),
              )}
            </div>
            <div
              className="text-[12px] leading-[1.4]"
              style={{ color: "rgba(255,255,255,0.65)" }}
            >
              <strong className="text-white">2,400+ producers</strong> running
              their hall
              <br />
              from bedrooms to platinum studios.
            </div>
          </div>
        </div>

        {/* Bottom city ticker — desktop only */}
        <div
          className="font-mono hidden gap-6 text-[11px] uppercase tracking-[0.14em] lg:flex"
          style={{ color: "rgba(255,255,255,0.45)" }}
        >
          <span>Tel-Aviv</span>
          <span>Berlin</span>
          <span>Lagos</span>
          <span>São Paulo</span>
          <span>Atlanta</span>
          <span>Seoul</span>
        </div>
      </div>
    </aside>
  );
}

// =============================================================================
// FormColumn — right column on desktop, primary surface on mobile
// =============================================================================

function FormColumn({ children }: { children: ReactNode }) {
  return (
    <section className="relative flex flex-col px-6 py-8 sm:px-10 sm:py-10 lg:px-14 lg:py-12">
      {/* Mobile-only condensed eyebrow — replaces the BrandPanel
          hero copy on small screens. */}
      <div className="lg:hidden">
        <div
          className="mb-2 text-[11px] font-bold uppercase tracking-[0.18em]"
          style={{ color: "rgb(var(--fg-muted))" }}
        >
          The hall
        </div>
        <h2
          className="font-syne mb-7 text-[28px] font-extrabold leading-[1.1]"
          style={{ letterSpacing: "-0.025em", color: "rgb(var(--fg-primary))" }}
        >
          Where producers run the business of music.
        </h2>
      </div>

      {/* Clerk form wrapper — centered on desktop, top-aligned on
          mobile. The wrapper is a flex column so Clerk's variable-
          height form expands without pushing the footer. */}
      <div className="flex flex-1 items-center justify-center">
        <div className="w-full max-w-[400px]">{children}</div>
      </div>

      {/* Footer links — same on every auth surface. */}
      <div
        className="mt-10 flex flex-wrap justify-between gap-3 text-[11.5px]"
        style={{ color: "rgb(var(--fg-muted))" }}
      >
        <span>© Skitza 2026</span>
        <div className="flex gap-4">
          <Link href="/terms" className="hover:underline">
            Terms
          </Link>
          <Link href="/privacy" className="hover:underline">
            Privacy
          </Link>
          <Link href="/about" className="hover:underline">
            About
          </Link>
        </div>
      </div>
    </section>
  );
}
